// Package process owns bounded analyzer subprocess lifetimes in the check lane.
package process

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"syscall"
	"time"
)

type boundedOutput struct {
	buffer bytes.Buffer
	limit  int
	cancel context.CancelFunc
}

func (output *boundedOutput) Write(value []byte) (int, error) {
	if len(value) > output.limit-output.buffer.Len() {
		output.cancel()
		return 0, fmt.Errorf("analyzer output exceeds %d bytes", output.limit)
	}
	return output.buffer.Write(value)
}

func Output(parent context.Context, directory, program string, args []string, input []byte) ([]byte, error) {
	ctx, cancel := context.WithTimeout(parent, 90*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, program, args...)
	command.Dir = directory
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	command.Stdin = bytes.NewReader(input)
	stdout := &boundedOutput{limit: 16 * 1024 * 1024, cancel: cancel}
	stderr := &boundedOutput{limit: 64 * 1024, cancel: cancel}
	command.Stdout, command.Stderr = stdout, stderr
	command.Cancel = func() error { return syscall.Kill(-command.Process.Pid, syscall.SIGKILL) }
	command.WaitDelay = 3 * time.Second
	if err := command.Start(); err != nil {
		return nil, err
	}
	defer syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
	if err := command.Wait(); err != nil {
		return nil, fmt.Errorf("native analyzer failed: %w: %s", err, stderr.buffer.String())
	}
	return stdout.buffer.Bytes(), nil
}
