#!/usr/bin/env python3
"""
ZeroMQ server-mode transcription worker for transcriber.
Binds to ports and acts as the server for the PUSH/PULL pattern.
This version has no inline dependencies for uv compatibility.
"""

# Import the actual worker
from zmq_server_worker import main

if __name__ == '__main__':
    main()