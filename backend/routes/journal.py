"""Journal endpoints — notes, tags, and screenshots per trade."""

import os
import time
import uuid
from flask import Blueprint, request, jsonify, send_from_directory
from db import get_db
from config import UPLOAD_DIR

journal_bp = Blueprint("journal", __name__)


# ── Notes ──

@journal_bp.route("/api/trades/<int:trade_id>/notes", methods=["GET"])
def get_notes(trade_id):
    conn = get_db()
    row = conn.execute(
        "SELECT notes FROM trade_notes WHERE trade_id = ?", (trade_id,)
    ).fetchone()
    conn.close()
    return jsonify({"notes": row["notes"] if row else ""})


@journal_bp.route("/api/trades/<int:trade_id>/notes", methods=["PUT"])
def save_notes(trade_id):
    data = request.get_json()
    notes = data.get("notes", "")
    now = int(time.time() * 1000)
    conn = get_db()
    conn.execute(
        """INSERT INTO trade_notes (trade_id, notes, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(trade_id) DO UPDATE SET notes = ?, updated_at = ?""",
        (trade_id, notes, now, notes, now),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ── Tags ──

@journal_bp.route("/api/trades/<int:trade_id>/tags", methods=["GET"])
def get_tags(trade_id):
    conn = get_db()
    rows = conn.execute(
        "SELECT tag FROM trade_tags WHERE trade_id = ?", (trade_id,)
    ).fetchall()
    conn.close()
    return jsonify({"tags": [r["tag"] for r in rows]})


@journal_bp.route("/api/trades/<int:trade_id>/tags", methods=["POST"])
def add_tag(trade_id):
    data = request.get_json()
    tag = data.get("tag", "").strip()
    if not tag:
        return jsonify({"error": "Tag cannot be empty"}), 400
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO trade_tags (trade_id, tag) VALUES (?, ?)",
            (trade_id, tag),
        )
        conn.commit()
    except Exception:
        pass  # Duplicate tag, ignore
    conn.close()
    return jsonify({"ok": True})


@journal_bp.route("/api/trades/<int:trade_id>/tags/<tag>", methods=["DELETE"])
def remove_tag(trade_id, tag):
    conn = get_db()
    conn.execute(
        "DELETE FROM trade_tags WHERE trade_id = ? AND tag = ?",
        (trade_id, tag),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@journal_bp.route("/api/tags", methods=["GET"])
def get_all_tags():
    """Get all unique tags across all trades."""
    conn = get_db()
    rows = conn.execute(
        "SELECT DISTINCT tag FROM trade_tags ORDER BY tag"
    ).fetchall()
    conn.close()
    return jsonify({"tags": [r["tag"] for r in rows]})


@journal_bp.route("/api/trade-tags", methods=["GET"])
def get_trade_tags_map():
    """Get all tag mappings for a wallet's trades.

    Returns a dict of trade_id -> [tag1, tag2, ...] for efficient
    client-side tag filtering without N+1 queries.
    """
    wallet = request.args.get("wallet")
    if not wallet:
        return jsonify({"error": "wallet query parameter is required"}), 400
    conn = get_db()
    rows = conn.execute(
        """SELECT tt.trade_id, tt.tag
           FROM trade_tags tt
           JOIN trades t ON t.id = tt.trade_id
           WHERE t.wallet = ?
           ORDER BY tt.trade_id""",
        (wallet,),
    ).fetchall()
    conn.close()
    result = {}
    for row in rows:
        tid = str(row["trade_id"])
        if tid not in result:
            result[tid] = []
        result[tid].append(row["tag"])
    return jsonify(result)


# ── Screenshots ──

@journal_bp.route("/api/trades/<int:trade_id>/screenshots", methods=["GET"])
def get_screenshots(trade_id):
    conn = get_db()
    rows = conn.execute(
        "SELECT id, filename, original_name, uploaded_at FROM trade_screenshots WHERE trade_id = ?",
        (trade_id,),
    ).fetchall()
    conn.close()
    return jsonify({"screenshots": [dict(r) for r in rows]})


@journal_bp.route("/api/trades/<int:trade_id>/screenshots", methods=["POST"])
def upload_screenshot(trade_id):
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "No file selected"}), 400

    # Validate file type
    allowed = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in allowed:
        return jsonify({"error": f"File type {ext} not allowed"}), 400

    # Save file with unique name
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{ext}"
    file.save(os.path.join(UPLOAD_DIR, filename))

    now = int(time.time() * 1000)
    conn = get_db()
    conn.execute(
        """INSERT INTO trade_screenshots (trade_id, filename, original_name, uploaded_at)
           VALUES (?, ?, ?, ?)""",
        (trade_id, filename, file.filename, now),
    )
    conn.commit()
    conn.close()

    return jsonify({"ok": True, "filename": filename})


@journal_bp.route("/api/screenshots/<filename>")
def serve_screenshot(filename):
    return send_from_directory(UPLOAD_DIR, filename)


@journal_bp.route("/api/screenshots/<int:screenshot_id>", methods=["DELETE"])
def delete_screenshot(screenshot_id):
    conn = get_db()
    row = conn.execute(
        "SELECT filename FROM trade_screenshots WHERE id = ?", (screenshot_id,)
    ).fetchone()
    if row:
        filepath = os.path.join(UPLOAD_DIR, row["filename"])
        if os.path.exists(filepath):
            os.remove(filepath)
        conn.execute("DELETE FROM trade_screenshots WHERE id = ?", (screenshot_id,))
        conn.commit()
    conn.close()
    return jsonify({"ok": True})
