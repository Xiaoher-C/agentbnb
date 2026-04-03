import { spawn, execSync } from 'node:child_process';
import {
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
  mkdirSync,
  openSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getConfigDir } from '../cli/config.js';
import { resolveSelfCli } from './resolve-self-cli.js';

const PID_FILE_NAME = 'serve.pid';
const LOG_DIR_NAME = 'logs';
const LOG_FILE_NAME = 'serve.log';

/** Flags consumed by the daemon layer that must not be forwarded to the child process. */
const DAEMON_FLAGS = ['--daemon', '--status', '--stop', '--restart', '--startup'] as const;

/**
 * Check if a process with given PID is running.
 * Returns true for EPERM (process exists but owned by another user).
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const killErr = err as NodeJS.ErrnoException;
    // Process exists but we lack permission to signal it
    if (killErr.code === 'EPERM') return true;
    return false;
  }
}

/**
 * Read PID from daemon PID file, return null if not found or stale.
 * Automatically cleans up stale PID files.
 */
export function readDaemonPid(): number | null {
  const pidFile = join(getConfigDir(), PID_FILE_NAME);
  if (!existsSync(pidFile)) return null;

  const raw = readFileSync(pidFile, 'utf-8').trim();
  const pid = parseInt(raw, 10);
  if (!Number.isFinite(pid)) {
    unlinkSync(pidFile);
    return null;
  }
  if (!isProcessRunning(pid)) {
    unlinkSync(pidFile);
    return null;
  }
  return pid;
}

/**
 * Start the serve process as a detached daemon.
 * Forks the current CLI with serve args, writes PID file, redirects output to log.
 */
export function startDaemon(serveArgs: string[]): void {
  if (readDaemonPid() !== null) {
    console.log(
      'AgentBnB serve daemon is already running. Use `agentbnb serve --restart` to restart.',
    );
    process.exit(0);
  }

  const dir = getConfigDir();
  const logDir = join(dir, LOG_DIR_NAME);
  mkdirSync(logDir, { recursive: true });

  const logFile = join(logDir, LOG_FILE_NAME);
  const out = openSync(logFile, 'a');
  const err = openSync(logFile, 'a');

  const cleanArgs = serveArgs.filter(
    (a) => !(DAEMON_FLAGS as readonly string[]).includes(a),
  );

  // Resolve CLI entry point using the shared resolver
  const entry = resolveSelfCli();

  const child = spawn(process.execPath, [entry, 'serve', ...cleanArgs], {
    detached: true,
    stdio: ['ignore', out, err],
    env: { ...process.env, AGENTBNB_DAEMON: '1' },
  });

  child.unref();

  const childPid = child.pid;
  if (childPid === undefined) {
    console.error('Failed to start daemon: no PID returned from spawn.');
    process.exit(1);
  }

  writeFileSync(join(dir, PID_FILE_NAME), String(childPid));

  console.log('AgentBnB serve started in background');
  console.log(`  PID:    ${childPid}`);
  console.log(`  Log:    ${logFile}`);
  console.log(`  Stop:   agentbnb serve --stop`);
  console.log(`  Status: agentbnb serve --status`);
}

/**
 * Print daemon status.
 */
export function daemonStatus(): void {
  const pid = readDaemonPid();
  const logFile = join(getConfigDir(), LOG_DIR_NAME, LOG_FILE_NAME);
  if (pid !== null) {
    console.log(`AgentBnB serve is running (PID: ${pid})`);
    console.log(`  Log: ${logFile}`);
  } else {
    console.log('AgentBnB serve is not running.');
  }
}

/**
 * Stop the daemon.
 */
export function stopDaemon(): void {
  const dir = getConfigDir();
  const pidFile = join(dir, PID_FILE_NAME);
  const pid = readDaemonPid();
  if (pid === null) {
    console.log('AgentBnB serve is not running.');
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    /* already dead */
  }
  if (existsSync(pidFile)) unlinkSync(pidFile);
  console.log(`Stopped AgentBnB serve (PID: ${pid})`);
}

/**
 * Restart the daemon with given serve args.
 * Returns a promise that resolves after the new daemon starts.
 */
export async function restartDaemon(serveArgs: string[]): Promise<void> {
  stopDaemon();
  // Small delay to let port release
  await new Promise<void>((resolve) => setTimeout(resolve, 1500));
  startDaemon(serveArgs);
}

/**
 * Register the daemon to start on system boot.
 * macOS: LaunchAgent plist. Linux: systemd user unit.
 */
export function registerStartup(serveArgs: string[]): void {
  const cleanArgs = serveArgs.filter(
    (a) => !(DAEMON_FLAGS as readonly string[]).includes(a),
  );

  const entry = resolveSelfCli();

  if (process.platform === 'darwin') {
    const plistDir = join(homedir(), 'Library', 'LaunchAgents');
    mkdirSync(plistDir, { recursive: true });
    const plistPath = join(plistDir, 'dev.agentbnb.serve.plist');
    const argsXml = ['serve', ...cleanArgs]
      .map((a) => `    <string>${a}</string>`)
      .join('\n');
    const logPath = join(getConfigDir(), 'logs', 'serve.log');
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.agentbnb.serve</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${entry}</string>
${argsXml}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${logPath}</string>
  <key>StandardErrorPath</key><string>${logPath}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>`;
    writeFileSync(plistPath, plist);
    try {
      execSync(`launchctl unload ${plistPath} 2>/dev/null`, { stdio: 'ignore' });
    } catch {
      /* ignore */
    }
    execSync(`launchctl load ${plistPath}`);
    console.log(`Registered startup: ${plistPath}`);
    console.log('AgentBnB serve will auto-start on login.');
  } else if (process.platform === 'linux') {
    const unitDir = join(homedir(), '.config', 'systemd', 'user');
    mkdirSync(unitDir, { recursive: true });
    const unitPath = join(unitDir, 'agentbnb-serve.service');
    const unit = `[Unit]
Description=AgentBnB Serve Daemon
After=network.target

[Service]
ExecStart=${process.execPath} ${entry} serve ${cleanArgs.join(' ')}
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;
    writeFileSync(unitPath, unit);
    execSync('systemctl --user daemon-reload');
    execSync('systemctl --user enable agentbnb-serve');
    console.log(`Registered startup: ${unitPath}`);
    console.log('AgentBnB serve will auto-start on login.');
  } else {
    console.log('Startup registration not supported on this platform.');
  }
}
