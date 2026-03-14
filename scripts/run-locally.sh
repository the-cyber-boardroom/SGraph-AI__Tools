#!/bin/bash
PORT=10063
DIR="sgraph_ai_tools__static"

echo "Starting tools.sgraph.ai local server..."
echo "  Root:  $(pwd)/$DIR"
echo "  URL:   http://localhost:$PORT"
echo "  Tests: http://localhost:$PORT/tests/"
echo "  Tools: http://localhost:$PORT/tools/"
echo ""

python3 -m http.server $PORT --directory "$DIR"
