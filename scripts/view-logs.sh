#!/bin/bash
#
# Scout Log Viewer
# A utility script to easily view Scout's logs from various sources on macOS
#

# ANSI color codes for better readability
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# App information
APP_NAME="Scout"
APP_BUNDLE_ID="com.arach.scout"
APP_PROCESS_NAME="Scout"

# Print header
echo -e "${BLUE}==================================${NC}"
echo -e "${BLUE}       Scout Log Viewer          ${NC}"
echo -e "${BLUE}==================================${NC}"

# Function to display help
show_help() {
    echo -e "${GREEN}Usage:${NC} $0 [option]"
    echo
    echo -e "${YELLOW}Options:${NC}"
    echo -e "  ${CYAN}-r, --realtime${NC}     Show real-time logs as they occur"
    echo -e "  ${CYAN}-h, --hour${NC}         Show logs from the last hour"
    echo -e "  ${CYAN}-d, --day${NC}          Show logs from the last day"
    echo -e "  ${CYAN}-s, --search${NC} TERM  Search logs for specific term"
    echo -e "  ${CYAN}-f, --files${NC}        List all log files related to Scout"
    echo -e "  ${CYAN}-c, --console${NC}      Open macOS Console app filtered for Scout"
    echo -e "  ${CYAN}-t, --tauri${NC}        Show logs for Tauri runtime"
    echo -e "  ${CYAN}--help${NC}             Show this help message"
    echo
    echo -e "${YELLOW}Examples:${NC}"
    echo -e "  $0 --realtime"
    echo -e "  $0 --search \"transcription\""
    echo
}

# Function to stream real-time logs
show_realtime_logs() {
    echo -e "${GREEN}Streaming real-time logs for $APP_NAME...${NC}"
    echo -e "${YELLOW}Press Ctrl+C to exit${NC}"
    echo
    log stream --style syslog --predicate "process == \"$APP_PROCESS_NAME\" OR (processImagePath CONTAINS[c] \"$APP_NAME\")"
}

# Function to show logs from last hour
show_hour_logs() {
    echo -e "${GREEN}Showing logs from the last hour for $APP_NAME...${NC}"
    echo
    log show --style syslog --predicate "process == \"$APP_PROCESS_NAME\" OR (processImagePath CONTAINS[c] \"$APP_NAME\")" --last 1h
}

# Function to show logs from last day
show_day_logs() {
    echo -e "${GREEN}Showing logs from the last day for $APP_NAME...${NC}"
    echo
    log show --style syslog --predicate "process == \"$APP_PROCESS_NAME\" OR (processImagePath CONTAINS[c] \"$APP_NAME\")" --last 24h
}

# Function to search logs
search_logs() {
    local term="$1"
    echo -e "${GREEN}Searching logs for term: ${YELLOW}$term${NC}"
    echo
    log show --style syslog --predicate "process == \"$APP_PROCESS_NAME\" OR (processImagePath CONTAINS[c] \"$APP_NAME\")" --last 7d | grep -i "$term"
}

# Function to find log files
find_log_files() {
    echo -e "${GREEN}Looking for $APP_NAME log files...${NC}"
    echo
    
    echo -e "${CYAN}System Logs:${NC}"
    find /var/log -name "*scout*" -o -name "*Scout*" 2>/dev/null
    
    echo -e "\n${CYAN}User Library Logs:${NC}"
    find ~/Library/Logs -name "*scout*" -o -name "*Scout*" 2>/dev/null
    
    echo -e "\n${CYAN}Application Support:${NC}"
    find ~/Library/Application\ Support -name "*scout*" -o -name "*Scout*" -path "*/logs/*" 2>/dev/null
    
    echo -e "\n${CYAN}Tauri Logs:${NC}"
    find ~/Library/Application\ Support/com.tauri.dev -name "*.log" 2>/dev/null
    find ~/Library/Application\ Support/$APP_BUNDLE_ID -name "*.log" 2>/dev/null
    
    echo -e "\n${CYAN}Crash Reports:${NC}"
    find ~/Library/Logs/DiagnosticReports -name "*scout*" -o -name "*Scout*" 2>/dev/null
}

# Function to open macOS Console app filtered for Scout
open_console() {
    echo -e "${GREEN}Opening macOS Console app filtered for $APP_NAME...${NC}"
    open -a "Console" --args --predicate "process == \"$APP_PROCESS_NAME\" OR (processImagePath CONTAINS[c] \"$APP_NAME\")"
}

# Function to show Tauri logs
show_tauri_logs() {
    echo -e "${GREEN}Showing Tauri logs for $APP_NAME...${NC}"
    echo
    
    TAURI_LOG_DIR="$HOME/Library/Application Support/$APP_BUNDLE_ID"
    
    if [ -d "$TAURI_LOG_DIR" ]; then
        echo -e "${CYAN}Tauri logs found in:${NC} $TAURI_LOG_DIR"
        find "$TAURI_LOG_DIR" -name "*.log" -exec echo -e "\n${YELLOW}{}${NC}:" \; -exec cat {} \;
    else
        echo -e "${RED}No Tauri logs found for $APP_BUNDLE_ID${NC}"
        
        # Try development logs
        DEV_LOG_DIR="$HOME/Library/Application Support/com.tauri.dev"
        if [ -d "$DEV_LOG_DIR" ]; then
            echo -e "${CYAN}Development Tauri logs found in:${NC} $DEV_LOG_DIR"
            find "$DEV_LOG_DIR" -name "*.log" -exec echo -e "\n${YELLOW}{}${NC}:" \; -exec cat {} \;
        else
            echo -e "${RED}No development Tauri logs found either${NC}"
        fi
    fi
}

# Parse command line arguments
if [ $# -eq 0 ]; then
    show_help
    exit 0
fi

case "$1" in
    -r|--realtime)
        show_realtime_logs
        ;;
    -h|--hour)
        show_hour_logs
        ;;
    -d|--day)
        show_day_logs
        ;;
    -s|--search)
        if [ -z "$2" ]; then
            echo -e "${RED}Error: Search term required${NC}"
            show_help
            exit 1
        fi
        search_logs "$2"
        ;;
    -f|--files)
        find_log_files
        ;;
    -c|--console)
        open_console
        ;;
    -t|--tauri)
        show_tauri_logs
        ;;
    --help)
        show_help
        ;;
    *)
        echo -e "${RED}Unknown option: $1${NC}"
        show_help
        exit 1
        ;;
esac

exit 0
