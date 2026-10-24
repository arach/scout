# macOS app update compatibility surface

The macOS app and its release procedures belong to the separate apps layer.
They are not part of Scout's public core build or npm artifact.

This directory retains the existing anonymously reachable Sparkle feed for
updater compatibility. Core source extraction does not authorize deleting,
redirecting or promoting that feed. The app release owner must preserve the
installed updater trust chain when moving distribution ownership.

Do not add app build/sign/notarization procedures to this core repository.
A core package release does not publish or promote a macOS app release.
