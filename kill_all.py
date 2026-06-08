import paramiko
import time

host = '82.27.201.169'
port = 22
username = 'root'
password = '09087691aA!'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(host, port=port, username=username, password=password,
            look_for_keys=False, allow_agent=False, timeout=15)

# Kill all processes with main.py in command line
ssh.exec_command("ps aux | grep '[m]ain.py' | awk '{print $2}' | xargs -r kill -9 2>/dev/null")
time.sleep(3)

# Also kill any lingering bash nohup shells
ssh.exec_command("ps aux | grep 'nohup.*main.py' | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null")
time.sleep(1)

# Verify all killed
stdin, stdout, stderr = ssh.exec_command("ps aux | grep '[m]ain.py' | grep -v grep || echo 'All killed'")
print('After kill:', stdout.read().decode().strip())

ssh.close()
