"""Flask application entry point."""

from flask import Flask
from flask_cors import CORS
from db import init_db
from routes.trades import trades_bp
from routes.journal import journal_bp
from routes.calendar import calendar_bp


def create_app():
    app = Flask(__name__)
    CORS(app)

    # Register route blueprints
    app.register_blueprint(trades_bp)
    app.register_blueprint(journal_bp)
    app.register_blueprint(calendar_bp)

    # Initialize database
    init_db()

    return app


if __name__ == "__main__":
    app = create_app()
    print("[APP] Starting Flask server on http://localhost:5001")
    app.run(debug=True, port=5001)
