import paramiko
import logging

logging.basicConfig(level=logging.DEBUG)

username = 'root'
password = '09087691aA!'
host = '82.27.201.169'
port = 22

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    ssh.connect(host, port=port, username=username, password=password,
                look_for_keys=False, allow_agent=False, timeout=15,
                banner_timeout=15, auth_timeout=15)
    print("SUCCESS!")
    stdin, stdout, stderr = ssh.exec_command('pwd && ls -la')
    print(stdout.read().decode())
    ssh.close()
except paramiko.AuthenticationException as e:
    print(f"AuthenticationException: {e}")
except paramiko.SSHException as e:
    print(f"SSHException: {e}")
except Exception as e:
    print(f"Other exception: {type(e).__name__}: {e}")
