#!/usr/bin/env python3
"""
Parakeet MLX worker that bypasses dependency issues with Python 3.13.
This directly uses the system Python with installed packages.
"""
import sys
import os

# Add site-packages to path to bypass uv dependency issues
sys.path.insert(0, '/Users/arach/lib/python3.13/site-packages')

# Now import and run the actual worker
from zmq_server_worker import main

if __name__ == '__main__':
    main()