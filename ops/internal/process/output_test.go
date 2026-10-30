package process

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestOutputHelper(t *testing.T) {
	separator := slices.Index(os.Args, "--")
	if separator < 0 {
		return
	}
	mode := os.Args[separator+1]
	if mode == "flood" {
		fmt.Print(strings.Repeat("x", 16*1024*1024+1))
		return
	}
	if mode == "child" {
		time.Sleep(30 * time.Second)
		return
	}
	child := exec.Command(os.Args[0], "-test.run=^TestOutputHelper$", "--", "child")
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(os.Args[separator+2], []byte(strconv.Itoa(child.Process.Pid)), 0600); err != nil {
		t.Fatal(err)
	}
	if err := child.Wait(); err != nil {
		t.Fatal(err)
	}
}

func TestOutputLimitStopsAnalyzer(t *testing.T) {
	_, err := Output(context.Background(), "", os.Args[0], []string{"-test.run=^TestOutputHelper$", "--", "flood"}, nil)
	if err == nil {
		t.Fatal("oversized analyzer output passed")
	}
}

func TestCancellationStopsNativeBackend(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pidFile := filepath.Join(t.TempDir(), "backend.pid")
	result := make(chan error, 1)
	go func() {
		_, err := Output(ctx, "", os.Args[0], []string{"-test.run=^TestOutputHelper$", "--", "parent", pidFile}, nil)
		result <- err
	}()
	deadline := time.Now().Add(5 * time.Second)
	var pid []byte
	for time.Now().Before(deadline) {
		if bytes, err := os.ReadFile(pidFile); err == nil {
			pid = bytes
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if len(pid) == 0 {
		t.Fatal("native backend did not start")
	}
	cancel()
	select {
	case err := <-result:
		if err == nil {
			t.Fatal("cancellation passed")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("analyzer did not stop")
	}
	for time.Now().Before(deadline) {
		state, err := os.ReadFile("/proc/" + string(pid) + "/stat")
		if os.IsNotExist(err) || strings.Contains(string(state), ") Z ") {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("native backend survived cancellation")
}
