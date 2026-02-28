# Gunicorn configuration file
import multiprocessing

# --- Bind ---
bind = "127.0.0.1:5000"

# --- Workers ---
# APScheduler требует ровно 1 воркер, иначе планировщик запустится несколько раз
workers = 1
worker_class = "sync"
threads = 4
timeout = 120
keepalive = 5

# --- Logging ---
accesslog = "/var/log/portfolio/access.log"
errorlog  = "/var/log/portfolio/error.log"
loglevel  = "info"
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s'

# --- Process ---
daemon = False          # systemd сам управляет процессом
preload_app = True      # загружать приложение до fork'а воркеров
