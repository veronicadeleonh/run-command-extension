# Run Command Hint

Saves the command to run each project and shows it **in the VS Code status bar** and **in the terminal when you `cd` into the project**.

Each project stores its command in a `.runcommand` file at the repo root.

---

## How it works

```
my-project/
├── .runcommand     ← contains: "npm run dev"
├── src/
└── package.json
```

---

## 1. VS Code Extension

### Manual installation (without publishing to the marketplace)

```bash
cp -r run-command-extension ~/.vscode/extensions/run-command-hint-1.0.0
```

Then in VS Code: `Cmd+Shift+P` → `Developer: Reload Window`

### Usage

| Action | How |
|--------|-----|
| Save the project command | Command Palette → `Run Command: Set project command` |
| Run the command | Click the status bar item (bottom left) |
| Clear the command | Command Palette → `Run Command: Clear project command` |

The status bar shows:
- `▶ npm run dev` — if a command is saved (click to run it)
- `+ Set run command` — in yellow if no command is set

### Auto-detection

When you run `Set project command`, the extension scans the project and suggests the right command:

| Project type | Suggested command |
|--------------|------------------|
| `package.json` with `dev` script | `npm run dev` |
| `package.json` with `start` script | `npm start` |
| `.py` file with `import streamlit` | `streamlit run <file>` |
| `app.py` or `main.py` | `python app.py` |
| `Cargo.toml` | `cargo run` |

Just pick from the list, or select "Type manually..." if you need a different command.

---

## 2. Zsh Plugin

### Installation

Add this line to your `~/.zshrc`:

```zsh
source /path/to/run-command-hint.plugin.zsh
```

For example, if you saved it in `~/dotfiles/`:

```zsh
source ~/dotfiles/run-command-hint.plugin.zsh
```

Then reload:

```zsh
source ~/.zshrc
```

### Usage

Every time you `cd` into a project with a `.runcommand` file, you'll see:

```
┌─ Run command
└──▶ npm run dev
```

**Available aliases:**
- `rch` — show the current project's command
- `rcr` — run the command directly

---

## Adding `.runcommand` to a project

From VS Code (command palette) or manually:

```bash
echo "npm run dev" > .runcommand
echo "streamlit run 0_overview.py" > .runcommand
echo "python app.py" > .runcommand
echo "cargo run" > .runcommand
```

---

## Add to .gitignore (optional)

If the command is personal and you don't want to commit it:

```bash
echo ".runcommand" >> .gitignore
```

Or commit it if you want the whole team to have it.
