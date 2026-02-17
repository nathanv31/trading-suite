"""Calendar endpoints — daily notes and weekly reviews."""

import time
from flask import Blueprint, request, jsonify
from db import get_db

calendar_bp = Blueprint("calendar", __name__)


# ── Day Notes ──

@calendar_bp.route("/api/calendar/notes/<date_key>", methods=["GET"])
def get_day_note(date_key):
    conn = get_db()
    row = conn.execute(
        "SELECT notes FROM calendar_notes WHERE date_key = ?", (date_key,)
    ).fetchone()
    conn.close()
    return jsonify({"notes": row["notes"] if row else ""})


@calendar_bp.route("/api/calendar/notes/<date_key>", methods=["PUT"])
def save_day_note(date_key):
    data = request.get_json()
    notes = data.get("notes", "")
    now = int(time.time() * 1000)
    conn = get_db()
    conn.execute(
        """INSERT INTO calendar_notes (date_key, notes, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(date_key) DO UPDATE SET notes = ?, updated_at = ?""",
        (date_key, notes, now, notes, now),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@calendar_bp.route("/api/calendar/notes", methods=["GET"])
def get_all_day_notes():
    """Get all day notes (for bulk loading)."""
    conn = get_db()
    rows = conn.execute("SELECT date_key, notes FROM calendar_notes").fetchall()
    conn.close()
    return jsonify({r["date_key"]: r["notes"] for r in rows})


# ── Week Notes ──

@calendar_bp.route("/api/calendar/week/<week_key>", methods=["GET"])
def get_week_note(week_key):
    conn = get_db()
    row = conn.execute(
        "SELECT review, well, improve FROM week_notes WHERE week_key = ?",
        (week_key,),
    ).fetchone()
    conn.close()
    if row:
        return jsonify(dict(row))
    return jsonify({"review": "", "well": "", "improve": ""})


@calendar_bp.route("/api/calendar/week/<week_key>", methods=["PUT"])
def save_week_note(week_key):
    data = request.get_json()
    now = int(time.time() * 1000)
    conn = get_db()
    conn.execute(
        """INSERT INTO week_notes (week_key, review, well, improve, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(week_key) DO UPDATE SET
               review = ?, well = ?, improve = ?, updated_at = ?""",
        (
            week_key,
            data.get("review", ""),
            data.get("well", ""),
            data.get("improve", ""),
            now,
            data.get("review", ""),
            data.get("well", ""),
            data.get("improve", ""),
            now,
        ),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@calendar_bp.route("/api/calendar/weeks", methods=["GET"])
def get_all_week_notes():
    """Get all week notes (for bulk loading)."""
    conn = get_db()
    rows = conn.execute(
        "SELECT week_key, review, well, improve FROM week_notes"
    ).fetchall()
    conn.close()
    return jsonify({r["week_key"]: dict(r) for r in rows})
