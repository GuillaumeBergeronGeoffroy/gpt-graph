"""Claude CLI integration: find binary, call claude, execute tasks."""

import json
import os
import shutil
import subprocess
import threading
import time
# Track active tasks
active_tasks = {}  # task_id -> task info


def find_claude_binary() -> str:
    """Find Claude binary path automatically."""
    if 'CLAUDE_BINARY_PATH' in os.environ:
        claude_path = os.environ['CLAUDE_BINARY_PATH']
        if os.path.exists(claude_path):
            return claude_path

    claude_path = shutil.which("claude")
    if claude_path:
        return claude_path

    raise RuntimeError("Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code")


CLAUDE_BINARY = find_claude_binary()
print(f"Using Claude binary: {CLAUDE_BINARY}")


def call_claude(prompt: str, model: str = "claude-opus-4-5-20251101") -> str:
    """Call Claude Code CLI and return the response."""
    print(f"\n{'='*60}")
    print(f"PROMPT ({len(prompt)} chars):")
    print(f"{prompt[:500]}{'...' if len(prompt) > 500 else ''}")
    print(f"{'='*60}")

    cmd = [
        CLAUDE_BINARY,
        "-p", prompt,
        "--model", model,
        "--output-format", "text",
        "--dangerously-skip-permissions"
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, cwd=os.getcwd())

    if result.returncode != 0:
        print(f"ERROR: {result.stderr}")
        raise RuntimeError(f"Claude CLI error: {result.stderr}")

    response = result.stdout.strip()
    print(f"\nRESPONSE ({len(response)} chars):")
    print(f"{response[:1000]}{'...' if len(response) > 1000 else ''}")
    print(f"{'='*60}\n")

    return response


def execute_claude_task(prompt: str, working_dir: str = None, model: str = "claude-opus-4-5-20251101", task_id: str = None) -> dict:
    """Execute a Claude Code task that can create files and run commands."""
    if working_dir:
        cwd = os.path.expanduser(working_dir)
    else:
        cwd = os.path.expanduser("~/claude-projects")

    os.makedirs(cwd, exist_ok=True)

    log_dir = os.path.expanduser("~/claude-projects/.logs")
    os.makedirs(log_dir, exist_ok=True)
    log_file = os.path.join(log_dir, f"{task_id or 'task'}.log")

    print(f"\n{'='*60}")
    print(f"EXECUTING TASK {task_id} in {cwd}")
    print(f"Log file: {log_file}")
    print(f"PROMPT ({len(prompt)} chars):")
    print(f"{prompt[:800]}{'...' if len(prompt) > 800 else ''}")
    print(f"{'='*60}")

    if task_id and task_id in active_tasks:
        active_tasks[task_id]['status'] = 'running'
        active_tasks[task_id]['working_dir'] = cwd
        active_tasks[task_id]['log_file'] = log_file
        active_tasks[task_id]['started_at'] = time.time()

    # Write prompt to a temp file to avoid ARG_MAX limits
    prompt_dir = os.path.expanduser("~/claude-projects/.logs")
    os.makedirs(prompt_dir, exist_ok=True)
    prompt_file_path = os.path.join(prompt_dir, f"{task_id or 'task'}-prompt.txt")
    with open(prompt_file_path, 'w') as pf:
        pf.write(prompt)

    bootstrap_prompt = (
        f"Your full task instructions are in the file: {prompt_file_path}\n"
        f"Read that file now and follow the instructions exactly."
    )

    cmd = [
        CLAUDE_BINARY,
        "-p", bootstrap_prompt,
        "--model", model,
        "--output-format", "stream-json",
        "--verbose",
        "--dangerously-skip-permissions"
    ]

    stderr_file = log_file + '.stderr'
    with open(log_file, 'w') as log, open(stderr_file, 'w') as stderr_log:
        log.write(f"=== Task started at {time.strftime('%Y-%m-%d %H:%M:%S')} ===\n")
        log.write(f"Working directory: {cwd}\n")
        log.write(f"Prompt file: {prompt_file_path}\n")
        log.write(f"{'='*60}\n\n")
        log.flush()

        process = subprocess.Popen(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=stderr_log,
            cwd=cwd,
            text=True,
            bufsize=1
        )

        output_texts = []
        exit_code = None

        try:
            while True:
                line = process.stdout.readline()
                if not line:
                    break

                line_str = line.strip()
                if not line_str:
                    continue

                try:
                    chunk = json.loads(line_str)
                    chunk_type = chunk.get('type', '')

                    if chunk_type == 'assistant':
                        message = chunk.get('message', {})
                        for block in message.get('content', []):
                            if block.get('type') == 'text':
                                text = block.get('text', '')
                                output_texts.append(text)
                                log.write(f"\n{'─'*50}\n")
                                log.write(f"ASSISTANT:\n{text}\n")
                            elif block.get('type') == 'tool_use':
                                tool_name = block.get('name', 'unknown')
                                tool_input = block.get('input', {})
                                log.write(f"\n{'─'*50}\n")
                                log.write(f"TOOL CALL: {tool_name}\n")
                                # Log tool input — truncate large values
                                for k, v in tool_input.items():
                                    val_str = str(v)
                                    if len(val_str) > 500:
                                        val_str = val_str[:500] + '...'
                                    log.write(f"  {k}: {val_str}\n")

                    elif chunk_type == 'user':
                        # Tool results come back as user messages
                        message = chunk.get('message', {})
                        for block in message.get('content', []):
                            if block.get('type') == 'tool_result':
                                tool_id = block.get('tool_use_id', '')
                                content = block.get('content', '')
                                if isinstance(content, list):
                                    content = '\n'.join(
                                        b.get('text', '') for b in content if b.get('type') == 'text'
                                    )
                                content_str = str(content)
                                if len(content_str) > 2000:
                                    content_str = content_str[:2000] + f'... ({len(content_str)} chars total)'
                                is_error = block.get('is_error', False)
                                label = 'TOOL ERROR' if is_error else 'TOOL RESULT'
                                log.write(f"{label}:\n{content_str}\n")

                    elif chunk_type == 'content_block_delta':
                        delta = chunk.get('delta', {})
                        if delta.get('type') == 'text_delta':
                            text = delta.get('text', '')
                            output_texts.append(text)
                            log.write(text)

                    elif chunk_type == 'result':
                        result_text = chunk.get('result', '')
                        if result_text and result_text not in ''.join(output_texts):
                            output_texts.append(result_text)
                            log.write(f"\n\n{'═'*50}\nFINAL RESULT:\n{result_text}\n")

                    log.flush()

                    if task_id and task_id in active_tasks:
                        full_output = ''.join(output_texts)
                        lines = full_output.split('\n')
                        active_tasks[task_id]['last_output'] = '\n'.join(lines[-20:])
                        active_tasks[task_id]['output_lines'] = len(lines)

                except json.JSONDecodeError:
                    log.write(line_str + '\n')
                    log.flush()

            process.wait(timeout=600)
            exit_code = process.returncode

        except subprocess.TimeoutExpired:
            process.kill()
            log.write("\n\n=== TASK TIMED OUT ===\n")
            raise

        try:
            with open(stderr_file, 'r') as sf:
                stderr_content = sf.read().strip()
                if stderr_content:
                    log.write(f"\n\n[STDERR]\n{stderr_content}\n")
        except Exception:
            pass

        log.write(f"\n{'='*60}\n")
        log.write(f"=== Task completed with exit code {exit_code} ===\n")

    try:
        os.unlink(prompt_file_path)
    except Exception:
        pass

    response = ''.join(output_texts).strip()

    print(f"\nTASK RESPONSE ({len(response)} chars):")
    print(f"{response[:1500]}{'...' if len(response) > 1500 else ''}")
    print(f"{'='*60}\n")

    files_created = []
    try:
        for root, dirs, files in os.walk(cwd):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for f in files:
                if not f.startswith('.'):
                    rel_path = os.path.relpath(os.path.join(root, f), cwd)
                    files_created.append(rel_path)
    except Exception as e:
        print(f"Error listing files: {e}")

    if task_id and task_id in active_tasks:
        active_tasks[task_id]['status'] = 'completed'
        active_tasks[task_id]['completed_at'] = time.time()
        active_tasks[task_id]['files'] = files_created[:50]

    return {
        "response": response,
        "working_dir": cwd,
        "files": files_created[:50],
        "exit_code": exit_code,
        "log_file": log_file,
        "task_id": task_id
    }


def start_task_async(prompt: str, working_dir: str, model: str, task_id: str):
    """Start a task in a background thread."""
    def run():
        try:
            result = execute_claude_task(prompt, working_dir, model, task_id)
            active_tasks[task_id]['result'] = result
            active_tasks[task_id]['status'] = 'completed'
        except Exception as e:
            active_tasks[task_id]['status'] = 'failed'
            active_tasks[task_id]['error'] = str(e)

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return thread
