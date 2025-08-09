#!/bin/bash
# Production launch script for Scout v0.4.1
# This script works around the AVCaptureDevice crash by setting environment variables

export SCOUT_SKIP_PERMISSION_CHECK=1
exec "$(dirname "$0")/Scout.app/Contents/MacOS/scout" "$@"