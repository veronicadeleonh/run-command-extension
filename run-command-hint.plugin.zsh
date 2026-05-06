#!/usr/bin/env zsh
# run-command-hint.plugin.zsh
# Muestra el comando del proyecto al entrar a una carpeta con .runcommand
# Instalación: source este archivo desde tu ~/.zshrc

RC_FILE=".runcommand"

_run_command_hint_chpwd() {
  local rc="$PWD/$RC_FILE"
  if [[ -f "$rc" ]]; then
    local cmd
    cmd=$(cat "$rc" | tr -d '\n')
    echo ""
    echo "\033[0;90m┌─ \033[1;36mRun command\033[0m"
    echo "\033[0;90m└──▶\033[0m \033[1;33m$cmd\033[0m"
    echo ""
  fi
}

# Hook: se ejecuta cada vez que cambia el directorio
autoload -Uz add-zsh-hook
add-zsh-hook chpwd _run_command_hint_chpwd

# También muestra al abrir una nueva shell si ya estás en un proyecto
_run_command_hint_chpwd

# Alias para leer el comando actual
alias rch='cat .runcommand 2>/dev/null && echo "" || echo "(no .runcommand found)"'

# Alias para ejecutar directamente
alias rcr='bash -c "$(cat .runcommand 2>/dev/null || echo \"echo No .runcommand found\")"'
