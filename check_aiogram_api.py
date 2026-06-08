import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=15)

script = '''
from aiogram import Dispatcher, Bot
import inspect
print("start_polling sig:", inspect.signature(Dispatcher.start_polling))
print("run_polling sig:", inspect.signature(Dispatcher.run_polling))
'''

stdin, stdout, stderr = ssh.exec_command(
    'cd /root/p2c-sniper-bot && venv/bin/python3 -u -c \'\'\'' + script + '\'\'\' 2>&1'
)
out = stdout.read().decode()
err = stderr.read().decode()

print('STDOUT:')
print(out)
print('STDERR:')
print(err)

ssh.close()
