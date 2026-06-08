import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=20)

# Run bot for max 20 seconds and capture output (no pkill!)
stdin, stdout, stderr = ssh.exec_command(
    'cd /root/p2c-sniper-bot && timeout 20 venv/bin/python3 -u main.py 2>&1; echo "EXIT_CODE=$?"'
, timeout=25)

out = stdout.read().decode()
err = stderr.read().decode()

print('=== STDOUT ===')
print(out if out else '(empty)')
print('=== STDERR ===')
print(err if err else '(empty)')

ssh.close()
