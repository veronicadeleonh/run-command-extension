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

  // package.json → npm scripts (root first, then one level deep)
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage', 'vendor']);

  function npmSuggestion(dir, prefix) {
    const pkgPath = path.join(dir, 'package.json');
    if (!fs.existsSync(pkgPath)) return null;
    try {
      const scripts = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts || {};
      const script = scripts.dev ? `npm run dev`
        : scripts.start         ? `npm start`
        : scripts.serve         ? `npm run serve`
        : null;
      if (!script) return null;
      const label = prefix ? `cd ${prefix} && ${script}` : script;
      const description = prefix ? `script en ${prefix}/package.json` : 'script en package.json';
      return { label, description };
    } catch { return null; }
  }

  const rootNpm = npmSuggestion(root, null);
  if (rootNpm) {
    suggestions.push(rootNpm);
  } else {
    // buscar en subdirectorios inmediatos
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        const s = npmSuggestion(path.join(root, entry.name), entry.name);
        if (s) suggestions.push(s);
      }
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
  // Status bar item — click ejecuta el comando en terminal
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'runCommandHint.runCommand';
  statusBar.tooltip = 'Click para ejecutar  |  Paleta: "Run Command: Edit" para cambiar el comando';
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

  // Detecta, guarda el primer resultado y notifica. force=true ignora comando existente.
  async function runDetect(force = false) {
    const root = getProjectRoot();
    if (!root) return;
    if (!force && readCommand(root)) return;
    const detected = detectCommands(root);
    if (detected.length === 0) {
      if (force) vscode.window.showInformationMessage('No se detectó ningún comando en este proyecto.');
      return;
    }
    const top = detected[0].label;
    writeCommand(root, top);
    refresh();
    const pick = await vscode.window.showInformationMessage(
      `Run command detectado: ${top}`,
      'Editar...'
    );
    if (pick === 'Editar...') {
      vscode.commands.executeCommand('runCommandHint.setCommand');
    }
  }
  runDetect();

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
        const MANUAL   = { label: '$(pencil) Escribir manualmente...', description: '' };
        const REDETECT = { label: '$(refresh) Detectar de nuevo',       description: '' };
        const CLEAR    = { label: '$(trash) Borrar comando guardado',   description: '' };
        const items    = [...detected, MANUAL, REDETECT, ...(current ? [CLEAR] : [])];
        const pick = await vscode.window.showQuickPick(items, {
          title: 'Run Command',
          placeHolder: current
            ? `Actual: ${current} — elige otro o edita`
            : 'Comando detectado — elige uno o escribe el tuyo',
        });
        if (pick === undefined) return;
        if (pick === REDETECT) {
          await runDetect(true);
          return;
        }
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

  // Click en barra de estado / paleta → ejecuta en terminal
  context.subscriptions.push(
    vscode.commands.registerCommand('runCommandHint.runCommand', async () => {
      const root = getProjectRoot();
      if (!root) return;
      let cmd = readCommand(root);
      if (!cmd) {
        // Sin comando guardado: primero configurar
        await vscode.commands.executeCommand('runCommandHint.setCommand');
        cmd = readCommand(root);
        if (!cmd) return;
      }
      const terminal = vscode.window.activeTerminal
        || vscode.window.createTerminal({ name: 'Run', cwd: root });
      terminal.show();
      terminal.sendText(cmd);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('runCommandHint.detectCommand', async () => {
      await runDetect(true);
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
