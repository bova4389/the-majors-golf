@echo off
echo Starting local server at http://localhost:8000
echo Open http://localhost:8000/index.html in your browser
echo Press Ctrl+C to stop the server
python -m http.server 8000
