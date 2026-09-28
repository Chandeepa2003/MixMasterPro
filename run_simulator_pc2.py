import http.server
import socketserver
import webbrowser
import os
import threading
import time

PORT = 8080
# Serve the simulator directory as root
DIRECTORY = "simulator"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)
    
    # Silence log messages for cleaner output
    def log_message(self, format, *args):
        pass

def start_server():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        httpd.serve_forever()

if __name__ == "__main__":
    print("\n" + "="*50)
    print("   MixMaster Standalone Simulator (PC2) ")
    print("="*50)
    
    if not os.path.exists(DIRECTORY):
        print(f"Error: Directory '{DIRECTORY}' not found.")
        print("Please run this script from the root of the project,")
        print("or ensure the 'simulator' folder is in the same directory.")
        exit(1)
        
    print(f"Starting local server for Web Serial API support...")
    
    # Run the server in a daemon thread
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()
    
    url = f"http://localhost:{PORT}/"
    print(f"Opening Simulator in default browser at {url}")
    
    # Small delay to ensure server is ready
    time.sleep(0.5)
    webbrowser.open(url)
    
    print("\n" + "-"*50)
    print("The Simulator MUST be run locally like this so the")
    print("browser allows USB Web Serial connection to the ESP32.")
    print("-" * 50)
    print("Press Ctrl+C to close the simulator server.\n")
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping Simulator...")
