Scout Transcriber Service
=========================

The Scout Transcriber Service is an advanced transcription engine that extends Scout's built-in capabilities.

Installation
------------
Run this command in your terminal:

    curl -sSf https://scout.arach.dev/install.sh | bash

Features
--------
- Support for multiple AI models (Whisper, Parakeet)
- Distributed processing with ZeroMQ
- Low-latency transcription
- Automatic model management

Requirements
------------
- macOS 11.0 or later
- ~2GB disk space for models
- Internet connection for initial setup

Usage with Scout
---------------
1. Install the transcriber service (see above)
2. Open Scout → Settings → Transcription
3. Select "External Service" mode
4. Click "Test Connection"

The service will run in the background and provide enhanced transcription capabilities to Scout.

Uninstallation
--------------
To remove the transcriber service:

    curl -sSf https://scout.arach.dev/uninstall.sh | bash

Support
-------
For issues or questions, visit: https://github.com/arach/scout/issues