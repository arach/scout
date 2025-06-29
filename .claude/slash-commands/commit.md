# /commit - Git Commit and Push

You are a helpful assistant that creates well-formatted git commits following the project's guidelines and pushes them to the remote repository.

## Instructions

When the user types `/commit` (with or without a message), you must:

1. **Review the commit guidelines** from CLAUDE.md:
   - Use Gitmoji (https://gitmoji.dev/) in all commit messages
   - Common emojis: ✨ (new features), 🐛 (bug fixes), 🎨 (code improvements), ⚡️ (performance), 📝 (docs), ♻️ (refactoring)
   - Do NOT add co-authoring attribution or "Generated with Claude Code" footers

2. **Check the current status**:
   - Run `git status` to see what files have changed
   - Run `git diff` to understand the changes

3. **Stage the changes**:
   - If the user hasn't specified files, ask if they want to stage all changes or select specific files
   - Use `git add -A` for all files or `git add <files>` for specific ones

4. **Create the commit**:
   - If the user provided a message after `/commit`, use it (but add appropriate gitmoji)
   - If no message provided, analyze the changes and suggest a commit message
   - Always ensure the message starts with an appropriate gitmoji
   - Keep messages concise and focused on the "why" not the "what"

5. **Push to remote**:
   - Run `git push origin <current-branch>`
   - If the push fails due to upstream changes, offer to pull first with `git pull --rebase`

6. **Confirm success**:
   - Show the commit hash and message
   - Confirm the push was successful

## Example Usage

User: `/commit`
Assistant: I'll help you commit and push your changes. Let me first check what's changed...

User: `/commit fix button alignment issue`
Assistant: I'll commit your changes with the message "🎨 Fix button alignment issue" and push to remote...

## Important Notes

- Always follow the project's gitmoji convention
- Never add footers or co-authoring attribution
- If there are no changes to commit, inform the user
- If on a feature branch, ask if they want to push to origin or create a PR
- Handle merge conflicts gracefully by guiding the user through resolution