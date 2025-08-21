#!/bin/bash

# Scout Transcriber Service Manager
# Professional service wrapper with PID management

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# Service configuration
SERVICE_NAME="transcriber"
PID_FILE="/tmp/transcriber.pid"
LOG_FILE="/tmp/transcriber.log"
LOCK_FILE="/tmp/transcriber.lock"

# Default values
MODEL="whisper"
WORKERS=2
MODE="sled"  # sled or zeromq
BACKGROUND=false
VERBOSE=false

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
BINARY="$SCRIPT_DIR/target/release/transcriber"

# Function to print colored output
print_info() {
    echo -e "${BLUE}ℹ${NC}  $1"
}

print_success() {
    echo -e "${GREEN}✓${NC}  $1"
}

print_error() {
    echo -e "${RED}✗${NC}  $1" >&2
}

print_warning() {
    echo -e "${YELLOW}⚠${NC}  $1"
}

print_status() {
    echo -e "${MAGENTA}●${NC}  $1"
}

# Help function
show_help() {
    cat << EOF
${GREEN}Scout Transcriber Service Manager${NC}

${YELLOW}Usage:${NC} ./transcriber.sh [COMMAND] [OPTIONS]

${YELLOW}COMMANDS:${NC}
    start       Start the transcriber service
    stop        Stop the transcriber service
    restart     Restart the transcriber service
    status      Check service status
    logs        Tail the transcriber logs
    clean       Clean up PID and lock files
    help        Show this help message

${YELLOW}OPTIONS:${NC}
    -m, --model MODEL      Model to use (whisper, parakeet, wav2vec2) [default: whisper]
    -w, --workers NUM      Number of workers [default: 2]
    -z, --zeromq          Use ZeroMQ mode (distributed processing)
    -b, --background      Run in background (daemon mode)
    -v, --verbose         Enable verbose logging
    -l, --log FILE        Log file path [default: /tmp/transcriber.log]

${YELLOW}EXAMPLES:${NC}
    # Start with Whisper (default)
    ./transcriber.sh start

    # Start with Parakeet in ZeroMQ mode (background)
    ./transcriber.sh start -m parakeet -z -b

    # Start with 4 workers in background
    ./transcriber.sh start -w 4 -b

    # Restart service
    ./transcriber.sh restart

    # Check status
    ./transcriber.sh status

    # View logs
    ./transcriber.sh logs

${YELLOW}FILES:${NC}
    PID File:  $PID_FILE
    Log File:  $LOG_FILE
    Lock File: $LOCK_FILE

EOF
}

# Parse command
COMMAND=${1:-help}
shift || true

# Parse options
while [[ $# -gt 0 ]]; do
    case $1 in
        -m|--model)
            MODEL="$2"
            shift 2
            ;;
        -w|--workers)
            WORKERS="$2"
            shift 2
            ;;
        -z|--zeromq)
            MODE="zeromq"
            shift
            ;;
        -b|--background)
            BACKGROUND=true
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -l|--log)
            LOG_FILE="$2"
            shift 2
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Check if binary exists
check_binary() {
    if [ ! -f "$BINARY" ]; then
        print_error "Transcriber binary not found at $BINARY"
        print_info "Please run 'cargo build --release' first"
        exit 1
    fi
}

# Function to get PID from file
get_pid() {
    if [ -f "$PID_FILE" ]; then
        cat "$PID_FILE"
    else
        echo ""
    fi
}

# Function to check if process is running
is_running() {
    local pid=$(get_pid)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        return 0
    else
        return 1
    fi
}

# Function to clean up stale PID file
cleanup_pid() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(get_pid)
        if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
            print_warning "Removing stale PID file"
            rm -f "$PID_FILE"
        fi
    fi
}

# Function to acquire lock
acquire_lock() {
    local timeout=10
    local elapsed=0
    
    while [ $elapsed -lt $timeout ]; do
        if mkdir "$LOCK_FILE" 2>/dev/null; then
            return 0
        fi
        sleep 0.5
        elapsed=$((elapsed + 1))
    done
    
    print_error "Could not acquire lock (timeout)"
    return 1
}

# Function to release lock
release_lock() {
    rm -rf "$LOCK_FILE" 2>/dev/null || true
}

# Cleanup on exit
cleanup_on_exit() {
    release_lock
}
trap cleanup_on_exit EXIT

# Function to stop transcriber
stop_transcriber() {
    print_info "Stopping transcriber service..."
    
    if ! acquire_lock; then
        exit 1
    fi
    
    local pid=$(get_pid)
    
    if [ -z "$pid" ]; then
        print_warning "No PID file found"
        
        # Try to find and kill anyway
        if pgrep -f "target/release/transcriber" > /dev/null 2>&1; then
            print_warning "Found running transcriber processes, killing them..."
            pkill -f "target/release/transcriber" 2>/dev/null || true
        fi
    else
        if kill -0 "$pid" 2>/dev/null; then
            print_info "Sending TERM signal to PID $pid"
            kill -TERM "$pid"
            
            # Wait for graceful shutdown
            local timeout=10
            while [ $timeout -gt 0 ] && kill -0 "$pid" 2>/dev/null; do
                sleep 1
                timeout=$((timeout - 1))
            done
            
            # Force kill if still running
            if kill -0 "$pid" 2>/dev/null; then
                print_warning "Process didn't stop gracefully, forcing..."
                kill -9 "$pid" 2>/dev/null || true
            fi
        else
            print_warning "Process $pid is not running"
        fi
        
        rm -f "$PID_FILE"
    fi
    
    # Clean up any orphaned Python workers
    pkill -f "zmq_server_worker.py" 2>/dev/null || true
    pkill -f "python/transcriber.py" 2>/dev/null || true
    
    # Clean up ports if needed
    for port in 5555 5556 5557; do
        local port_pid=$(lsof -ti :$port 2>/dev/null || true)
        if [ ! -z "$port_pid" ]; then
            print_warning "Cleaning up process on port $port (PID: $port_pid)"
            kill -9 $port_pid 2>/dev/null || true
        fi
    done
    
    print_success "Transcriber service stopped"
}

# Function to start transcriber
start_transcriber() {
    check_binary
    
    if ! acquire_lock; then
        exit 1
    fi
    
    # Clean up any stale PID file
    cleanup_pid
    
    # Check if already running
    if is_running; then
        local pid=$(get_pid)
        print_error "Transcriber is already running (PID: $pid)"
        print_info "Use './transcriber.sh stop' to stop it first"
        exit 1
    fi
    
    # Build command
    local CMD="$BINARY"
    
    # Add model
    CMD="$CMD --model $MODEL"
    
    # Handle ZeroMQ mode
    if [ "$MODE" = "zeromq" ]; then
        CMD="$CMD --use-zeromq"
        CMD="$CMD --python-args \"run python/zmq_server_worker.py\""
        
        # ZeroMQ server mode only supports 1 worker
        if [ "$WORKERS" -gt 1 ]; then
            print_warning "ZeroMQ server mode only supports 1 worker, setting workers=1"
            WORKERS=1
        fi
    fi
    
    # Add workers
    CMD="$CMD --workers $WORKERS"
    
    # Add verbose flag
    if [ "$VERBOSE" = true ]; then
        CMD="$CMD --log-level debug"
    fi
    
    # Print configuration
    print_status "Starting Scout Transcriber Service"
    print_info "Configuration:"
    echo "    Model:   $MODEL"
    echo "    Workers: $WORKERS"
    echo "    Mode:    $MODE"
    echo "    Log:     $LOG_FILE"
    
    if [ "$MODE" = "zeromq" ]; then
        echo "    Ports:   5555 (input), 5556 (output), 5557 (control)"
    fi
    
    # Start the service
    if [ "$BACKGROUND" = true ]; then
        print_info "Starting in background mode..."
        
        # Start in background and capture PID
        nohup $CMD > "$LOG_FILE" 2>&1 &
        local pid=$!
        
        # Save PID
        echo $pid > "$PID_FILE"
        
        # Wait a moment to check if it started successfully
        sleep 2
        
        if kill -0 $pid 2>/dev/null; then
            print_success "Transcriber started successfully"
            print_info "PID: $pid"
            print_info "View logs: ./transcriber.sh logs"
            
            # Show first few log lines
            if [ -f "$LOG_FILE" ]; then
                echo ""
                print_info "Initial log output:"
                head -n 5 "$LOG_FILE" | sed 's/^/    /'
            fi
        else
            print_error "Failed to start transcriber"
            rm -f "$PID_FILE"
            
            if [ -f "$LOG_FILE" ]; then
                print_info "Recent errors:"
                tail -n 10 "$LOG_FILE" | grep -E "ERROR|FATAL|Failed" | sed 's/^/    /' || tail -n 5 "$LOG_FILE" | sed 's/^/    /'
            fi
            exit 1
        fi
    else
        print_info "Starting in foreground mode..."
        print_info "Press Ctrl+C to stop"
        
        # Run in foreground
        $CMD 2>&1 | tee "$LOG_FILE"
    fi
}

# Function to restart service
restart_transcriber() {
    print_info "Restarting transcriber service..."
    
    if is_running; then
        stop_transcriber
        sleep 2
    fi
    
    start_transcriber
}

# Function to check status
check_status() {
    cleanup_pid
    
    if is_running; then
        local pid=$(get_pid)
        print_success "Transcriber is RUNNING (PID: $pid)"
        
        # Show process info
        echo ""
        print_info "Process details:"
        ps aux | grep -E "^\S+\s+$pid" | sed 's/^/    /' || echo "    Unable to get process details"
        
        # Show memory usage
        if command -v pmap &> /dev/null; then
            local mem=$(pmap $pid 2>/dev/null | tail -n 1 | awk '{print $2}')
            if [ -n "$mem" ]; then
                echo "    Memory: $mem"
            fi
        fi
        
        # Check ports
        echo ""
        print_info "Network ports:"
        for port in 5555 5556 5557; do
            if lsof -i :$port > /dev/null 2>&1; then
                echo "    Port $port: LISTENING"
            else
                echo "    Port $port: NOT IN USE"
            fi
        done
        
        # Show recent logs
        if [ -f "$LOG_FILE" ]; then
            echo ""
            print_info "Recent activity:"
            tail -n 3 "$LOG_FILE" | sed 's/^/    /'
        fi
    else
        print_warning "Transcriber is NOT RUNNING"
        
        # Check if there's a stale PID file
        if [ -f "$PID_FILE" ]; then
            local pid=$(get_pid)
            print_info "Stale PID file found (PID: $pid)"
        fi
        
        # Show last error if log exists
        if [ -f "$LOG_FILE" ]; then
            local last_error=$(grep -E "ERROR|FATAL|Failed" "$LOG_FILE" | tail -n 1)
            if [ -n "$last_error" ]; then
                print_info "Last error:"
                echo "    $last_error"
            fi
        fi
    fi
}

# Function to tail logs
tail_logs() {
    if [ ! -f "$LOG_FILE" ]; then
        print_error "Log file not found: $LOG_FILE"
        exit 1
    fi
    
    print_info "Tailing logs from $LOG_FILE"
    print_info "Press Ctrl+C to stop"
    echo ""
    tail -f "$LOG_FILE"
}

# Function to clean up files
clean_files() {
    print_info "Cleaning up service files..."
    
    if is_running; then
        print_error "Cannot clean while service is running"
        print_info "Stop the service first: ./transcriber.sh stop"
        exit 1
    fi
    
    [ -f "$PID_FILE" ] && rm -f "$PID_FILE" && print_success "Removed PID file"
    [ -d "$LOCK_FILE" ] && rm -rf "$LOCK_FILE" && print_success "Removed lock file"
    [ -f "$LOG_FILE" ] && rm -f "$LOG_FILE" && print_success "Removed log file"
    
    # Clean up temp queues
    [ -d "/tmp/transcriber" ] && rm -rf "/tmp/transcriber" && print_success "Removed temp queues"
    
    print_success "Cleanup complete"
}

# Main command handler
case $COMMAND in
    start)
        start_transcriber
        ;;
    stop)
        stop_transcriber
        ;;
    restart)
        restart_transcriber
        ;;
    status)
        check_status
        ;;
    logs)
        tail_logs
        ;;
    clean)
        clean_files
        ;;
    help)
        show_help
        ;;
    *)
        print_error "Unknown command: $COMMAND"
        show_help
        exit 1
        ;;
esac