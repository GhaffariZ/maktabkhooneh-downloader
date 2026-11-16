using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

namespace Maktabkhooneh.DesktopLauncher
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new LauncherForm(args));
        }
    }

    internal class LauncherForm : Form
    {
        private Process _childProcess;
        private volatile bool _isShuttingDown;
        private string _serverUrl;
        private bool _autoOpened;

        private Label _statusLabel;
        private Label _urlLabel;
        private Button _openButton;
        private Button _quitButton;
        private ProgressBar _progressBar;

        // Command-line flag overrides
        private bool _noOpen;
        private bool _demo;
        private int? _portOverride;

        public LauncherForm(string[] args)
        {
            ParseArgs(args);
            InitializeComponent();
        }

        private void ParseArgs(string[] args)
        {
            for (int i = 0; i < args.Length; i++)
            {
                string arg = args[i];
                if (string.Equals(arg, "--no-open", StringComparison.OrdinalIgnoreCase))
                {
                    _noOpen = true;
                }
                else if (string.Equals(arg, "--demo", StringComparison.OrdinalIgnoreCase))
                {
                    _demo = true;
                }
                else if (string.Equals(arg, "--port", StringComparison.OrdinalIgnoreCase))
                {
                    int port;
                    _portOverride = i + 1 < args.Length && int.TryParse(args[++i], out port) && port >= 0 && port <= 65535 ? port : -1;
                }
            }
        }

        private void InitializeComponent()
        {
            Text = "Maktabkhooneh Study Library";
            ClientSize = new Size(420, 190);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = true;
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
            BackColor = Color.FromArgb(248, 249, 250);

            _statusLabel = new Label
            {
                Text = "Starting local server...",
                Location = new Point(20, 20),
                Size = new Size(380, 24),
                Font = new Font("Segoe UI", 10F, FontStyle.Bold, GraphicsUnit.Point)
            };

            _progressBar = new ProgressBar
            {
                Location = new Point(20, 52),
                Size = new Size(380, 16),
                Style = ProgressBarStyle.Marquee,
                MarqueeAnimationSpeed = 30
            };

            _urlLabel = new Label
            {
                Text = "Initializing runtime...",
                Location = new Point(20, 80),
                Size = new Size(380, 24),
                ForeColor = Color.FromArgb(108, 117, 125)
            };

            _openButton = new Button
            {
                Text = "Open Dashboard",
                Location = new Point(170, 130),
                Size = new Size(130, 36),
                Enabled = false,
                UseVisualStyleBackColor = true
            };
            _openButton.Click += (s, e) => OpenBrowser();

            _quitButton = new Button
            {
                Text = "Quit",
                Location = new Point(310, 130),
                Size = new Size(90, 36),
                UseVisualStyleBackColor = true
            };
            _quitButton.Click += (s, e) => Close();

            Controls.Add(_statusLabel);
            Controls.Add(_progressBar);
            Controls.Add(_urlLabel);
            Controls.Add(_openButton);
            Controls.Add(_quitButton);
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            StartChildServer();
        }

        private void StartChildServer()
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string nodePath = Path.Combine(baseDir, "runtime", "node.exe");
            string scriptPath = Path.Combine(baseDir, "scripts", "desktop.mjs");

            if (!File.Exists(nodePath))
            {
                MessageBox.Show(
                    "Embedded Node.js runtime not found.\nExpected location: " + nodePath,
                    "Runtime Missing",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                Application.Exit();
                return;
            }

            if (!File.Exists(scriptPath))
            {
                MessageBox.Show(
                    "Desktop script entry point not found.\nExpected location: " + scriptPath,
                    "Script Missing",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                Application.Exit();
                return;
            }

            string childArguments = "\"" + scriptPath + "\"";
            if (_demo)
            {
                childArguments += " --demo";
            }
            if (_portOverride.HasValue)
            {
                childArguments += " --port " + _portOverride.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
            }

            var startInfo = new ProcessStartInfo
            {
                FileName = nodePath,
                Arguments = childArguments,
                WorkingDirectory = baseDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            startInfo.EnvironmentVariables.Remove("NODE_OPTIONS");
            startInfo.EnvironmentVariables.Remove("NODE_PATH");
            startInfo.EnvironmentVariables["NODE_ENV"] = "production";

            try
            {
                _childProcess = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
                _childProcess.OutputDataReceived += OnChildOutput;
                _childProcess.ErrorDataReceived += OnChildError;
                _childProcess.Exited += OnChildExited;

                if (!_childProcess.Start())
                {
                    throw new InvalidOperationException("Failed to start child process.");
                }

                _childProcess.BeginOutputReadLine();
                _childProcess.BeginErrorReadLine();
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Failed to launch background service:\n" + ex.Message,
                    "Startup Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                Application.Exit();
            }
        }

        private void OnChildOutput(object sender, DataReceivedEventArgs e)
        {
            if (e.Data == null) return;
            string line = e.Data.Trim();

            // Match READY http://127.0.0.1:<port>/
            const string prefix = "READY ";
            if (line.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                string rawUrl = line.Substring(prefix.Length).Trim();
                Uri validUri;
                if (ValidateReadyUrl(rawUrl, out validUri))
                {
                    UpdateUi(() =>
                    {
                        _serverUrl = validUri.AbsoluteUri;
                        _statusLabel.Text = "Server is running";
                        _urlLabel.Text = _serverUrl;
                        _progressBar.Visible = false;
                        _openButton.Enabled = true;

                        if (!_noOpen && !_autoOpened)
                        {
                            _autoOpened = true;
                            OpenBrowser();
                        }
                    });
                }
            }
        }

        private void OnChildError(object sender, DataReceivedEventArgs e)
        {
            if (e.Data == null) return;
            string text = e.Data.Trim();
            if (string.IsNullOrEmpty(text)) return;

            UpdateUi(() =>
            {
                if (text.IndexOf("EADDRINUSE", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    text.IndexOf("address already in use", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    _statusLabel.Text = "Port already in use";
                    _urlLabel.Text = "Close the other dashboard or app using this port, then reopen.";
                }
                else if (string.IsNullOrEmpty(_serverUrl))
                {
                    _statusLabel.Text = "Server error occurred";
                    _urlLabel.Text = text.Length > 80 ? text.Substring(0, 77) + "..." : text;
                }
            });
        }

        private void OnChildExited(object sender, EventArgs e)
        {
            if (_isShuttingDown) return;

            UpdateUi(() =>
            {
                _progressBar.Visible = false;
                _openButton.Enabled = false;
                int exitCode = -1;
                try
                {
                    if (_childProcess != null && _childProcess.HasExited)
                    {
                        exitCode = _childProcess.ExitCode;
                    }
                }
                catch { }

                if (_serverUrl == null && _statusLabel.Text != "Starting local server...")
                {
                    return;
                }

                _statusLabel.Text = "Server stopped";
                _urlLabel.Text = "Process exited with code " + exitCode + ".";
            });
        }

        private void UpdateUi(Action update)
        {
            if (_isShuttingDown) return;
            try
            {
                BeginInvoke(new Action(() =>
                {
                    if (!_isShuttingDown) update();
                }));
            }
            catch (InvalidOperationException)
            {
                if (!_isShuttingDown) throw;
            }
        }

        private static bool ValidateReadyUrl(string url, out Uri result)
        {
            result = null;
            Uri uri;
            if (!Uri.TryCreate(url, UriKind.Absolute, out uri))
            {
                return false;
            }

            // Must be HTTP scheme
            if (!string.Equals(uri.Scheme, "http", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            if (uri.Host != "127.0.0.1")
            {
                return false;
            }

            // Port must be valid non-zero TCP port
            if (uri.Port <= 0 || uri.Port > 65535)
            {
                return false;
            }

            if (uri.PathAndQuery != "/" || uri.Fragment.Length != 0 || uri.UserInfo.Length != 0)
            {
                return false;
            }

            result = uri;
            return true;
        }

        private void OpenBrowser()
        {
            if (string.IsNullOrEmpty(_serverUrl)) return;
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = _serverUrl,
                    UseShellExecute = true
                });
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Unable to open default browser:\n" + ex.Message,
                    "Browser Launch Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            _isShuttingDown = true;
            ShutdownChildProcess();
            base.OnFormClosing(e);
        }

        private void ShutdownChildProcess()
        {
            if (_childProcess == null) return;

            try
            {
                if (!_childProcess.HasExited)
                {
                    // Request graceful shutdown via closed stdin
                    try
                    {
                        _childProcess.StandardInput.Close();
                    }
                    catch { }

                    // Allow child process up to 3 seconds to cleanly exit
                    if (!_childProcess.WaitForExit(3000))
                    {
                        _childProcess.Kill();
                    }
                }
            }
            catch { }
            finally
            {
                try
                {
                    _childProcess.Dispose();
                }
                catch { }
                _childProcess = null;
            }
        }
    }
}
