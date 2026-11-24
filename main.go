// Local BPMN and form editor. Stdlib only. Listens on 127.0.0.1.
package main

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

//go:embed all:web
var embeddedPublic embed.FS

const maxBytes = 10 << 20

type fileInfo struct {
	Name    string  `json:"name"`
	Size    int64   `json:"size"`
	MtimeMs float64 `json:"mtimeMs"`
}

func defaultDir() string {
	if v := os.Getenv("BPMN_FILES"); v != "" {
		return v
	}
	if v := os.Getenv("FILES"); v != "" {
		return v
	}
	if st, err := os.Stat("/workspace/bpmn-files"); err == nil && st.IsDir() {
		return "/workspace/bpmn-files"
	}
	return "diagrams"
}

func isAllowedExt(name string) bool {
	lower := strings.ToLower(name)
	return strings.HasSuffix(lower, ".bpmn") || strings.HasSuffix(lower, ".form")
}

func isSafeName(name string) bool {
	if name == "" || len(name) < 6 || len(name) > 200 {
		return false
	}
	if strings.ContainsAny(name, "/\\:\x00") || strings.Contains(name, "..") {
		return false
	}
	if path.Base(name) != name || strings.HasPrefix(name, ".") {
		return false
	}
	return isAllowedExt(name)
}

func resolvePath(dir, name string) (string, error) {
	if !isSafeName(name) {
		return "", fmt.Errorf("ungültiger Dateiname")
	}
	root, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	full := filepath.Join(root, name)
	rel, err := filepath.Rel(root, full)
	if err != nil || strings.HasPrefix(rel, "..") || rel == "." {
		return "", fmt.Errorf("ungültiger Pfad")
	}
	return full, nil
}

func listFiles(dir string) ([]fileInfo, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []fileInfo{}, nil
		}
		return nil, err
	}
	out := make([]fileInfo, 0)
	for _, ent := range entries {
		if ent.IsDir() || !isSafeName(ent.Name()) {
			continue
		}
		info, err := ent.Info()
		if err != nil {
			continue
		}
		if !info.Mode().IsRegular() {
			continue
		}
		out = append(out, fileInfo{
			Name:    ent.Name(),
			Size:    info.Size(),
			MtimeMs: float64(info.ModTime().UnixMilli()),
		})
	}
	return out, nil
}

func dirSignature(files []fileInfo) string {
	h := sha256.New()
	for _, f := range files {
		fmt.Fprintf(h, "%s:%d:%g\n", f.Name, f.Size, f.MtimeMs)
	}
	return hex.EncodeToString(h.Sum(nil))
}

func looksLikeBPMN(body string) bool {
	return strings.Contains(body, "http://www.omg.org/spec/BPMN") || strings.Contains(strings.ToLower(body), "bpmn")
}

func looksLikeForm(body string) bool {
	var obj map[string]any
	if err := json.Unmarshal([]byte(body), &obj); err != nil {
		return false
	}
	_, hasType := obj["type"]
	_, hasComponents := obj["components"]
	return hasType || hasComponents
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

type sseHub struct {
	mu      sync.Mutex
	clients map[chan []byte]struct{}
}

func newHub() *sseHub {
	return &sseHub{clients: make(map[chan []byte]struct{})}
}

func (h *sseHub) add() chan []byte {
	ch := make(chan []byte, 8)
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *sseHub) remove(ch chan []byte) {
	h.mu.Lock()
	delete(h.clients, ch)
	h.mu.Unlock()
	close(ch)
}

func (h *sseHub) broadcast(payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	msg := append(append([]byte("data: "), data...), '\n', '\n')
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.clients {
		select {
		case ch <- msg:
		default:
		}
	}
}

func main() {
	log.SetFlags(0)

	port := 3456
	if v := os.Getenv("PORT"); v != "" {
		if _, err := fmt.Sscanf(v, "%d", &port); err != nil || port <= 0 || port > 65535 {
			log.Fatalf("Ungültiger PORT: %s", v)
		}
	}
	flag.IntVar(&port, "port", port, "Port (nur 127.0.0.1)")
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage: %s [options] [ordner]\n\n", filepath.Base(os.Args[0]))
		fmt.Fprintf(os.Stderr, "Serves the local BPMN and form editor on http://127.0.0.1:<port>/\n")
		fmt.Fprintf(os.Stderr, "Files (*.bpmn, *.form) are read and written in the given folder.\n\n")
		flag.PrintDefaults()
	}
	flag.Parse()

	dir := defaultDir()
	if flag.NArg() >= 1 {
		dir = flag.Arg(0)
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		log.Fatal(err)
	}
	dir = abs
	if err := os.MkdirAll(dir, 0o755); err != nil {
		log.Fatalf("Ordner anlegen: %v", err)
	}

	public, err := fs.Sub(embeddedPublic, "web")
	if err != nil {
		log.Fatalf("eingebettete Dateien: %v", err)
	}

	hub := newHub()
	go func() {
		var last string
		t := time.NewTicker(300 * time.Millisecond)
		defer t.Stop()
		for range t.C {
			files, err := listFiles(dir)
			if err != nil {
				continue
			}
			sig := dirSignature(files)
			if last == "" {
				last = sig
				continue
			}
			if sig != last {
				last = sig
				hub.broadcast(map[string]any{"type": "change", "time": time.Now().UnixMilli()})
			}
		}
	}()

	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/status", func(w http.ResponseWriter, r *http.Request) {
		files, err := listFiles(dir)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "Ordner konnte nicht gelesen werden.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"dir":   dir,
			"host":  "127.0.0.1",
			"port":  port,
			"files": files,
		})
	})

	mux.HandleFunc("GET /api/files", func(w http.ResponseWriter, r *http.Request) {
		files, err := listFiles(dir)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "Ordner konnte nicht gelesen werden.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"files": files})
	})

	mux.HandleFunc("GET /api/events", func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			writeErr(w, http.StatusInternalServerError, "Streaming nicht verfügbar.")
			return
		}
		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("retry: 3000\n\n"))
		flusher.Flush()

		ch := hub.add()
		defer hub.remove(ch)
		heartbeat := time.NewTicker(25 * time.Second)
		defer heartbeat.Stop()
		ctx := r.Context()
		for {
			select {
			case <-ctx.Done():
				return
			case <-heartbeat.C:
				if _, err := w.Write([]byte(": ping\n\n")); err != nil {
					return
				}
				flusher.Flush()
			case msg, ok := <-ch:
				if !ok {
					return
				}
				if _, err := w.Write(msg); err != nil {
					return
				}
				flusher.Flush()
			}
		}
	})

	handleGetFile := func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		full, err := resolvePath(dir, name)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "Ungültiger Dateiname. Nur *.bpmn und *.form im Ordner, ohne Unterordner.")
			return
		}
		data, err := os.ReadFile(full)
		if err != nil {
			if os.IsNotExist(err) {
				writeErr(w, http.StatusNotFound, "Datei nicht gefunden.")
				return
			}
			writeErr(w, http.StatusInternalServerError, "Datei konnte nicht gelesen werden.")
			return
		}
		st, err := os.Stat(full)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "Datei konnte nicht gelesen werden.")
			return
		}
		ctype := "application/octet-stream"
		if strings.HasSuffix(strings.ToLower(name), ".form") {
			ctype = "application/json; charset=utf-8"
		} else {
			ctype = "application/xml; charset=utf-8"
		}
		w.Header().Set("Content-Type", ctype)
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-File-Name", path.Base(name))
		w.Header().Set("X-File-Mtime", fmt.Sprintf("%d", st.ModTime().UnixMilli()))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)
	}

	handlePutFile := func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		full, err := resolvePath(dir, name)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "Ungültiger Dateiname. Nur *.bpmn und *.form im Ordner, ohne Unterordner.")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
		body, err := io.ReadAll(r.Body)
		if err != nil {
			writeErr(w, http.StatusRequestEntityTooLarge, "Datei ist größer als 10 MB.")
			return
		}
		text := string(body)
		if strings.HasSuffix(strings.ToLower(name), ".form") {
			if !looksLikeForm(text) {
				writeErr(w, http.StatusBadRequest, "Inhalt sieht nicht nach einem form-js-JSON (.form) aus.")
				return
			}
		} else if !looksLikeBPMN(text) {
			writeErr(w, http.StatusBadRequest, "Inhalt sieht nicht nach BPMN-XML aus.")
			return
		}
		if err := os.WriteFile(full, body, 0o644); err != nil {
			writeErr(w, http.StatusInternalServerError, "Datei konnte nicht gespeichert werden.")
			return
		}
		st, err := os.Stat(full)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "Datei konnte nicht gespeichert werden.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"name":    name,
			"size":    st.Size(),
			"mtimeMs": float64(st.ModTime().UnixMilli()),
		})
	}

	handleDeleteFile := func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		full, err := resolvePath(dir, name)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "Ungültiger Dateiname. Nur *.bpmn und *.form im Ordner, ohne Unterordner.")
			return
		}
		if err := os.Remove(full); err != nil {
			if os.IsNotExist(err) {
				writeErr(w, http.StatusNotFound, "Datei nicht gefunden.")
				return
			}
			writeErr(w, http.StatusInternalServerError, "Datei konnte nicht gelöscht werden.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "name": name})
	}

	mux.HandleFunc("GET /api/files/{name}", handleGetFile)
	mux.HandleFunc("PUT /api/files/{name}", handlePutFile)
	mux.HandleFunc("DELETE /api/files/{name}", handleDeleteFile)

	fileServer := http.FileServer(http.FS(public))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt.")
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		fileServer.ServeHTTP(w, r)
	})

	addr := fmt.Sprintf("127.0.0.1:%d", port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		if strings.Contains(err.Error(), "address already in use") {
			log.Fatalf("Port %d ist belegt. Anderen Port setzen: %s -port 3457 %q", port, filepath.Base(os.Args[0]), dir)
		}
		log.Fatal(err)
	}

	fmt.Printf("Editor:       http://%s/\n", addr)
	fmt.Printf("Dateien in:   %s\n", dir)
	fmt.Printf("Nur lokal erreichbar (127.0.0.1). Beenden mit Strg+C.\n")

	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
