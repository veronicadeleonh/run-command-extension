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
      if (scripts.dev)        suggestions.push({ label: 'npm run dev',   description: 'script en package.json' });
      else if (scripts.start) suggestions.push({ label: 'npm start',     description: 'script en package.json' });
      else if (scripts.serve) suggestions.push({ label: 'npm run serve', description: 'script en package.json' });
    } catch {}
  }

  // Python files — detect Flask, Streamlit, o plain Python
  let pyFiles = [];
  try { pyFiles = fs.readdirSync(root).filter(f => f.endsWith('.py')); } catch {}

  const flaskFiles = [];
  const streamlitFiles = [];

  for (const f of pyFiles) {
    try {
      const content = fs.readFileSync(path.join(root, f), 'utf8');
      if (content.includes('import streamlit') || content.includes('from streamlit')) {
        streamlitFiles.push(f);
      } else if (content.includes('from flask') || content.includes('import flask') || content.includes('Flask(__name__)')) {
        flaskFiles.push(f);
      }
    } catch {}
  }

  if (streamlitFiles.length > 0) {
    const entry = streamlitFiles.find(f => /^0_/i.test(f))
      || streamlitFiles.find(f => f === 'app.py')
      || streamlitFiles[0];
    suggestions.push({ label: `streamlit run ${entry}`, description: 'Streamlit app detectada' });
  } else if (flaskFiles.length > 0) {
    const entry = flaskFiles.find(f => f === 'app.py') || flaskFiles[0];
    suggestions.push({ label: `flask run`, description: `Flask app detectada (${entry})` });
    suggestions.push({ label: `python ${entry}`, description: `Correr directamente con Python` });
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
  // Status bar item — click abre el editor para ver/cambiar el comando
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'runCommandHint.setCommand';
  statusBar.tooltip = 'Click para editar el comando  |  Paleta: "Run Command: Run" para ejecutar';
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

  // Auto-detect on startup si no hay comando guardado
  async function autoDetect() {
    const root = getProjectRoot();
    if (!root || readCommand(root)) return;
    const detected = detectCommands(root);
    if (detected.length === 0) return;
    const top = detected[0].label;
    const pick = await vscode.window.showInformationMessage(
      `Run command detectado: ${top}`,
      'Guardar', 'Elegir...'
    );
    if (pick === 'Guardar') {
      writeCommand(root, top);
      refresh();
    } else if (pick === 'Elegir...') {
      vscode.commands.executeCommand('runCommandHint.setCommand');
    }
  }
  autoDetect();

  // --- Commands ---

  // Click en barra de estado → abre picker para ver/editar/cambiar
  context.subscriptions.push(
    vscode.commands.registerCommand('runCommandHint.setCommand', async () => {
      const root = getProjectRoot();
      if (!root) return vscode.window.showErrorMessage('No hay workspace abierto.');

      const current = readCommand(root) || '';
      const detected = detectCommands(root);

      let cmd;

      if (detected.length > 0) {
        const MANUAL = { label: '$(pencil) Escribir manualmente...', description: '' };
        const CLEAR  = { label: '$(trash) Borrar comando guardado',  description: '' };
        const items  = [...detected, MANUAL, ...(current ? [CLEAR] : [])];
        const pick = await vscode.window.showQuickPick(items, {
          title: 'Run Command',
          placeHolder: current
            ? `Actual: ${current} — elige otro o edita`
            : 'Comando detectado — elige uno o escribe el tuyo',
        });
        if (pick === undefined) return;
        if (pick === CLEAR) {
          clearCommand(root);
          vscode.window.showInformationMessage('Run command eliminado.');
          refresh();
          return;
        }
        if (pick === MANUAL) {
          cmd = await vscode.window.showInputBox({
            prompt: 'Comando para correr este proyecto',
            value: current,
            placeHolder: 'npm run dev',
            title: 'Run Command',
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
          title: 'Run Command',
        });
        if (cmd === undefined) return;
      }

      if (cmd.trim() === '') {
        clearCommand(root);
        vscode.window.showInformationMessage('Run command eliminado.');
      } else {
        writeCommand(root, cmd);
        vscode.window.showInformationMessage(`Run command guardado: ${cmd}`);
      }
      refresh();
    })
  );

  // Paleta de comandos → ejecutar directamente en terminal
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
      vscode.window.showInformationMessage('Run command eliminado.');
      refresh();
    })
  );

  refresh();
}

function deactivate() {}

module.exports = { activate, deactivate };
