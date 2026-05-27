const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const RC_FILE = '.runcommand';

function getProjectRoot() {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : null;
}

function getRcPath(root) {
  return path.join(root, RC_FILE);
}

function readCommand(root) {
  try {
    const rcPath = getRcPath(root);
    if (fs.existsSync(rcPath)) {
      return fs.readFileSync(rcPath, 'utf8').trim();
    }
  } catch {}
  return null;
}

function writeCommand(root, cmd) {
  fs.writeFileSync(getRcPath(root), cmd.trim() + '\n', 'utf8');
}

function clearCommand(root) {
  const rcPath = getRcPath(root);
  if (fs.existsSync(rcPath)) fs.unlinkSync(rcPath);
}

function detectCommands(root) {
  const suggestions = [];

  // package.json → npm scripts
  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const scripts = pkg.scripts || {};
      if (scripts.dev)   suggestions.push({ label: 'npm run dev',   description: 'script en package.json' });
      else if (scripts.start)  suggestions.push({ label: 'npm start',      description: 'script en package.json' });
      else if (scripts.serve)  suggestions.push({ label: 'npm run serve',  description: 'script en package.json' });
    } catch {}
  }

  // Python files — detect streamlit vs plain python
  let pyFiles = [];
  try { pyFiles = fs.readdirSync(root).filter(f => f.endsWith('.py')); } catch {}

  const streamlitFiles = [];
  for (const f of pyFiles) {
    try {
      const content = fs.readFileSync(path.join(root, f), 'utf8');
      if (content.includes('import streamlit') || content.includes('from streamlit')) {
        streamlitFiles.push(f);
      }
    } catch {}
  }

  if (streamlitFiles.length > 0) {
    // Multipage apps suelen empezar con 0_, si no app.py, si no el primero
    const entry = streamlitFiles.find(f => /^0_/i.test(f))
      || streamlitFiles.find(f => f === 'app.py')
      || streamlitFiles[0];
    suggestions.push({ label: `streamlit run ${entry}`, description: 'Streamlit app detectada' });
  } else {
    const mainPy = pyFiles.find(f => f === 'app.py') || pyFiles.find(f => f === 'main.py');
    if (mainPy) suggestions.push({ label: `python ${mainPy}`, description: 'Python app detectada' });
  }

  // Cargo.toml → Rust
  if (fs.existsSync(path.join(root, 'Cargo.toml'))) {
    suggestions.push({ label: 'cargo run', description: 'Proyecto Rust detectado' });
  }

  return suggestions;
}

function activate(context) {
  // Status bar item
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'runCommandHint.runCommand';
  statusBar.tooltip = 'Click to run in terminal  |  Right-click for options';
  context.subscriptions.push(statusBar);

  function refresh() {
    const root = getProjectRoot();
    if (!root) { statusBar.hide(); return; }
    const cmd = readCommand(root);
    if (cmd) {
      statusBar.text = `$(play) ${cmd}`;
      statusBar.backgroundColor = undefined;
      statusBar.show();
    } else {
      statusBar.text = `$(plus) Set run command`;
      statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      statusBar.show();
    }
  }

  // Watch for .runcommand file changes
  const watcher = vscode.workspace.createFileSystemWatcher(`**/${RC_FILE}`);
  watcher.onDidCreate(refresh);
  watcher.onDidChange(refresh);
  watcher.onDidDelete(refresh);
  context.subscriptions.push(watcher);

  // Refresh when workspace changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(refresh)
  );

  // Auto-detect on startup if no command is saved
  async function autoDetect() {
    const root = getProjectRoot();
    if (!root || readCommand(root)) return;
    const detected = detectCommands(root);
    if (detected.length === 0) return;
    const top = detected[0].label;
    const pick = await vscode.window.showInformationMessage(
      `Run command detected: ${top}`,
      'Save', 'Choose...'
    );
    if (pick === 'Save') {
      writeCommand(root, top);
      refresh();
    } else if (pick === 'Choose...') {
      vscode.commands.executeCommand('runCommandHint.setCommand');
    }
  }
  autoDetect();

  // --- Commands ---

  context.subscriptions.push(
    vscode.commands.registerCommand('runCommandHint.setCommand', async () => {
      const root = getProjectRoot();
      if (!root) return vscode.window.showErrorMessage('No workspace open.');

      const current = readCommand(root) || '';
      const detected = detectCommands(root);

      let cmd;

      if (detected.length > 0) {
        const MANUAL = { label: '$(pencil) Escribir manualmente...', description: '' };
        const items = [...detected, MANUAL];
        const pick = await vscode.window.showQuickPick(items, {
          title: 'Set Run Command',
          placeHolder: 'Comando detectado — elige uno o escribe el tuyo',
        });
        if (pick === undefined) return; // cancelled
        if (pick === MANUAL) {
          cmd = await vscode.window.showInputBox({
            prompt: 'Comando para correr este proyecto',
            value: current,
            placeHolder: 'npm run dev',
            title: 'Set Run Command',
          });
          if (cmd === undefined) return;
        } else {
          cmd = pick.label;
        }
      } else {
        cmd = await vscode.window.showInputBox({
          prompt: 'Comando para correr este proyecto (ej. npm run dev, python app.py)',
          value: current,
          placeHolder: 'npm run dev',
          title: 'Set Run Command',
        });
        if (cmd === undefined) return;
      }

      if (cmd.trim() === '') {
        clearCommand(root);
        vscode.window.showInformationMessage('Run command cleared.');
      } else {
        writeCommand(root, cmd);
        vscode.window.showInformationMessage(`Run command saved: ${cmd}`);
      }
      refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('runCommandHint.runCommand', async () => {
      const root = getProjectRoot();
      if (!root) return;
      const cmd = readCommand(root);
      if (!cmd) {
        vscode.commands.executeCommand('runCommandHint.setCommand');
        return;
      }
      const terminal = vscode.window.activeTerminal
        || vscode.window.createTerminal({ name: 'Run', cwd: root });
      terminal.show();
      terminal.sendText(cmd);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('runCommandHint.clearCommand', async () => {
      const root = getProjectRoot();
      if (!root) return;
      clearCommand(root);
      vscode.window.showInformationMessage('Run command cleared.');
      refresh();
    })
  );

  // Status bar click shows a quick pick with all options
  // Override the direct run with a menu when right-clicking... 
  // VS Code doesn't support right-click on status bar natively,
  // so we use the Command Palette for extras.

  refresh();
}

function deactivate() {}

module.exports = { activate, deactivate };
