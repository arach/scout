#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyzmq",
# ]
# ///
"""
ZeroMQ proxy/broker for scout-transcriber.
Forwards messages between clients and workers.
"""

import sys
import zmq
import logging
from threading import Thread

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def forward_messages(frontend, backend, name):
    """Forward messages from frontend to backend."""
    logger.info(f"Starting {name} forwarder")
    
    while True:
        try:
            # Receive from frontend
            message = frontend.recv()
            logger.debug(f"{name}: Forwarding {len(message)} bytes")
            
            # Send to backend
            backend.send(message)
            
        except zmq.ZMQError as e:
            logger.error(f"{name}: ZMQ error: {e}")
            break
        except Exception as e:
            logger.error(f"{name}: Error: {e}")
            break
    
    logger.info(f"{name} forwarder stopped")


def main():
    """Run the ZeroMQ proxy."""
    context = zmq.Context()
    
    # Frontend: Clients push audio here
    frontend_in = context.socket(zmq.PULL)
    frontend_in.bind("tcp://127.0.0.1:5555")
    logger.info("Frontend IN bound to tcp://127.0.0.1:5555 (clients PUSH here)")
    
    # Backend: Workers pull audio from here
    backend_out = context.socket(zmq.PUSH)
    backend_out.bind("tcp://127.0.0.1:5559")
    logger.info("Backend OUT bound to tcp://127.0.0.1:5559 (workers PULL here)")
    
    # Backend: Workers push results here
    backend_in = context.socket(zmq.PULL)
    backend_in.bind("tcp://127.0.0.1:5558")
    logger.info("Backend IN bound to tcp://127.0.0.1:5558 (workers PUSH here)")
    
    # Frontend: Clients pull results from here
    frontend_out = context.socket(zmq.PUSH)
    frontend_out.bind("tcp://127.0.0.1:5556")
    logger.info("Frontend OUT bound to tcp://127.0.0.1:5556 (clients PULL here)")
    
    # Start forwarding threads
    audio_thread = Thread(
        target=forward_messages,
        args=(frontend_in, backend_out, "Audio"),
        daemon=True
    )
    audio_thread.start()
    
    result_thread = Thread(
        target=forward_messages,
        args=(backend_in, frontend_out, "Result"),
        daemon=True
    )
    result_thread.start()
    
    logger.info("ZeroMQ proxy running. Press Ctrl+C to stop.")
    
    try:
        # Keep main thread alive
        audio_thread.join()
        result_thread.join()
    except KeyboardInterrupt:
        logger.info("Shutting down proxy...")
    finally:
        frontend_in.close()
        frontend_out.close()
        backend_in.close()
        backend_out.close()
        context.term()
        logger.info("Proxy stopped")


if __name__ == "__main__":
    main()