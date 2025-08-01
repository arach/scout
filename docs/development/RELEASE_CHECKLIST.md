# Scout v0.2.0 Release Checklist

## Pre-Release
- [x] Version bumped to 0.2.0 in:
  - [x] package.json
  - [x] Cargo.toml
  - [x] tauri.conf.json
- [x] Progressive transcription implemented
- [x] Conditional model checking added
- [x] Blog post written and styled
- [x] Release notes prepared
- [x] DMG created (Scout-v0.2.0.dmg - 11MB)

## Release Steps
1. [ ] Test DMG installer on clean machine
2. [ ] Commit all changes
3. [ ] Create and push tag: `git tag -a v0.2.0 -m "Release v0.2.0"`
4. [ ] Create GitHub release with DMG
5. [ ] Publish release (not draft)

## Post-Release
1. [ ] Merge to main branch for blog deployment
2. [ ] Announce on:
   - [ ] Twitter/X
   - [ ] Discord
   - [ ] Reddit (r/MacApps)
3. [ ] Update README with v0.2.0 features
4. [ ] Monitor for user feedback

## Verification
- [ ] Progressive transcription works with both models
- [ ] Falls back gracefully with single model
- [ ] Blog displays correctly on GitHub Pages
- [ ] DMG installs without issues

## Marketing Copy

**One-liner**: Scout v0.2.0 - Transcription at the speed of thought. Sub-300ms latency.

**Tweet**: 
🚀 Scout v0.2.0 is here! 

No more waiting for transcripts. Progressive processing delivers your words in <300ms.

⚡ 85-94% faster
🧠 Dual-model intelligence
💯 100% local & private

Download: [link]
Technical deep dive: [blog link]

#macOS #transcription #rust