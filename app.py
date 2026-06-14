from __future__ import annotations

import json
import os
import sqlite3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "recruitment_tracking.db"
SCHEMA_PATH = BASE_DIR / "schema.sql"
WEB_DIR = BASE_DIR / "web"


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode = OFF")
    connection.execute("PRAGMA synchronous = OFF")
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db() -> None:
    with connect() as connection:
        connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        ensure_column(connection, "requisitions", "section", "TEXT")
        ensure_column(connection, "requisitions", "status", "TEXT NOT NULL DEFAULT 'ongoing'")
        ensure_column(connection, "document_groups", "group_id", "TEXT")
        migrate_position_groups(connection)


def ensure_column(connection: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in columns:
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def row_to_dict(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    return {key: row[key] for key in row.keys()}


def rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict]:
    return [row_to_dict(row) for row in rows]


def clean_payload(payload: dict) -> dict:
    return {key: (None if value == "" else value) for key, value in payload.items()}


def log_change(connection: sqlite3.Connection, entity: str, entity_id: str, action: str, old_data: dict | None, new_data: dict | None) -> None:
    connection.execute(
        """
        INSERT INTO change_logs (entity, entity_id, action, old_data, new_data)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            entity,
            entity_id,
            action,
            json.dumps(old_data, ensure_ascii=False, default=str) if old_data is not None else None,
            json.dumps(new_data, ensure_ascii=False, default=str) if new_data is not None else None,
        ),
    )


def require_mode(payload: dict) -> str:
    mode = payload.get("mode") or "new"
    if mode not in {"new", "change"}:
        raise ValueError("mode must be new or change")
    return mode


def next_id(connection: sqlite3.Connection, table: str, column: str, prefix: str) -> str:
    rows = connection.execute(f"SELECT {column} FROM {table} WHERE {column} LIKE ? ORDER BY {column}", (f"{prefix}-%",)).fetchall()
    max_number = 0
    for row in rows:
        try:
            max_number = max(max_number, int(str(row[column]).split("-")[-1]))
        except ValueError:
            continue
    return f"{prefix}-{max_number + 1:04d}"


def migrate_position_groups(connection: sqlite3.Connection) -> None:
    rows = connection.execute(
        """
        SELECT *
        FROM document_groups
        WHERE group_id IS NULL OR group_id = ''
        ORDER BY created_at, doc_group_id
        """
    ).fetchall()
    for row in rows:
        group_id = next_id(connection, "position_groups", "group_id", "GRP")
        connection.execute(
            """
            INSERT INTO position_groups (
              group_id, group_position, channel_fb, channel_jobthai, channel_jobtopgun, channel_jobdb
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                group_id,
                row["group_position"],
                row["channel_fb"],
                row["channel_jobthai"],
                row["channel_jobtopgun"],
                row["channel_jobdb"],
            ),
        )
        connection.execute("UPDATE document_groups SET group_id = ? WHERE doc_group_id = ?", (group_id, row["doc_group_id"]))


def update_requisition_status(connection: sqlite3.Connection, doc_id: str) -> None:
    requisition = connection.execute("SELECT * FROM requisitions WHERE doc_id = ?", (doc_id,)).fetchone()
    if requisition is None or requisition["status"] == "cancel":
        return

    accepted_count = connection.execute(
        """
        SELECT COUNT(*) AS accepted_count
        FROM offers
        WHERE doc_id = ? AND accepted_date IS NOT NULL
        """,
        (doc_id,),
    ).fetchone()["accepted_count"]
    next_status = "filled" if accepted_count >= requisition["head_count"] else "ongoing"
    if next_status != requisition["status"]:
        old_data = row_to_dict(requisition)
        connection.execute("UPDATE requisitions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE doc_id = ?", (next_status, doc_id))
        new_data = row_to_dict(connection.execute("SELECT * FROM requisitions WHERE doc_id = ?", (doc_id,)).fetchone())
        log_change(connection, "requisitions", doc_id, "auto-status", old_data, new_data)


def get_dashboard() -> dict:
    with connect() as connection:
        requisitions = rows_to_dicts(
            connection.execute(
                """
                SELECT
                  r.*,
                  r.status AS current_status,
                  COALESCE(candidate_counts.candidate_count, 0) AS candidate_count,
                  COALESCE(offer_counts.offer_count, 0) AS offer_count
                FROM requisitions r
                LEFT JOIN (
                  SELECT dg.doc_id, COUNT(c.candidate_id) AS candidate_count
                  FROM document_groups dg
                  LEFT JOIN candidates c ON c.doc_group_id = dg.doc_group_id
                  GROUP BY dg.doc_id
                ) candidate_counts ON candidate_counts.doc_id = r.doc_id
                LEFT JOIN (
                  SELECT doc_id, COUNT(*) AS offer_count
                  FROM offers
                  WHERE accepted_date IS NOT NULL
                  GROUP BY doc_id
                ) offer_counts ON offer_counts.doc_id = r.doc_id
                ORDER BY r.updated_at DESC, r.created_at DESC
                """
            ).fetchall()
        )

        groups = rows_to_dicts(
            connection.execute(
                """
                SELECT dg.*, r.position, r.department, r.site, r.section, r.person_in_charge
                FROM document_groups dg
                INNER JOIN requisitions r ON r.doc_id = dg.doc_id
                ORDER BY dg.created_at DESC
                """
            ).fetchall()
        )

        position_groups = rows_to_dicts(
            connection.execute(
                """
                SELECT *
                FROM position_groups
                ORDER BY updated_at DESC, created_at DESC
                """
            ).fetchall()
        )

        candidates = rows_to_dicts(
            connection.execute(
                """
                SELECT
                  c.*,
                  dg.doc_id,
                  dg.group_position,
                  r.site,
                  r.person_in_charge,
                  accepted.accepted_date,
                  COALESCE(latest.recruitment_process, 'No activity') AS latest_process,
                  latest.result AS latest_result
                FROM candidates c
                INNER JOIN document_groups dg ON dg.doc_group_id = c.doc_group_id
                INNER JOIN requisitions r ON r.doc_id = dg.doc_id
                LEFT JOIN (
                  SELECT rl.candidate_id, rl.recruitment_process, rl.result
                  FROM recruitment_logs rl
                  INNER JOIN (
                    SELECT candidate_id, MAX(log_id) AS latest_log_id
                    FROM recruitment_logs
                    GROUP BY candidate_id
                  ) latest_ids ON latest_ids.latest_log_id = rl.log_id
                ) latest ON latest.candidate_id = c.candidate_id
                LEFT JOIN (
                  SELECT candidate_id, MIN(accepted_date) AS accepted_date
                  FROM offers
                  WHERE accepted_date IS NOT NULL
                  GROUP BY candidate_id
                ) accepted ON accepted.candidate_id = c.candidate_id
                ORDER BY c.updated_at DESC, c.created_at DESC
                """
            ).fetchall()
        )

        requisition_logs = rows_to_dicts(
            connection.execute(
                """
                SELECT *
                FROM requisition_logs
                ORDER BY log_date DESC, log_id DESC
                LIMIT 50
                """
            ).fetchall()
        )

        recruitment_logs = rows_to_dicts(
            connection.execute(
                """
                SELECT rl.*, c.name AS candidate_name, r.site, r.person_in_charge
                FROM recruitment_logs rl
                INNER JOIN candidates c ON c.candidate_id = rl.candidate_id
                INNER JOIN document_groups dg ON dg.doc_group_id = c.doc_group_id
                INNER JOIN requisitions r ON r.doc_id = dg.doc_id
                ORDER BY rl.log_date DESC, rl.log_id DESC
                LIMIT 50
                """
            ).fetchall()
        )

        offers = rows_to_dicts(
            connection.execute(
                """
                SELECT o.*, c.name AS candidate_name, r.position, r.site, r.person_in_charge
                FROM offers o
                INNER JOIN candidates c ON c.candidate_id = o.candidate_id
                INNER JOIN requisitions r ON r.doc_id = o.doc_id
                ORDER BY o.updated_at DESC, o.created_at DESC
                """
            ).fetchall()
        )

        change_logs = rows_to_dicts(
            connection.execute(
                """
                SELECT *
                FROM change_logs
                ORDER BY changed_at DESC, log_id DESC
                LIMIT 50
                """
            ).fetchall()
        )

    return {
        "requisitions": requisitions,
        "position_groups": position_groups,
        "groups": groups,
        "candidates": candidates,
        "requisition_logs": requisition_logs,
        "recruitment_logs": recruitment_logs,
        "offers": offers,
        "change_logs": change_logs,
    }


def upsert_requisition(payload: dict) -> dict:
    data = clean_payload(payload)
    mode = require_mode(data)
    with connect() as connection:
        existing = row_to_dict(connection.execute("SELECT * FROM requisitions WHERE doc_id = ?", (data["doc_id"],)).fetchone())
        if mode == "new" and existing is not None:
            raise ValueError("Requisition Doc ID already exists. Switch to Change mode to edit it.")
        if mode == "change" and existing is None:
            raise ValueError("Requisition Doc ID does not exist. Switch to New mode to create it.")

        status = data.get("status") or (existing or {}).get("status") or "ongoing"
        if status not in {"ongoing", "cancel"}:
            raise ValueError("Requisition status can only be ongoing or cancel. Filled is automatic.")

        connection.execute(
            """
            INSERT INTO requisitions (
              doc_id, pr_approved_date, site, position, department, section, level,
              head_count, person_in_charge, line_manager, status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(doc_id) DO UPDATE SET
              pr_approved_date = excluded.pr_approved_date,
              site = excluded.site,
              position = excluded.position,
              department = excluded.department,
              section = excluded.section,
              level = excluded.level,
              head_count = excluded.head_count,
              person_in_charge = excluded.person_in_charge,
              line_manager = excluded.line_manager,
              status = excluded.status,
              updated_at = CURRENT_TIMESTAMP
            """,
            (
                data["doc_id"],
                data.get("pr_approved_date"),
                data["site"],
                data["position"],
                data["department"],
                data.get("section"),
                data.get("level"),
                int(data.get("head_count") or 1),
                data.get("person_in_charge"),
                data.get("line_manager"),
                status,
            ),
        )
        update_requisition_status(connection, data["doc_id"])
        new_data = row_to_dict(connection.execute("SELECT * FROM requisitions WHERE doc_id = ?", (data["doc_id"],)).fetchone())
        log_change(connection, "requisitions", data["doc_id"], mode, existing, new_data)
    return {"ok": True}


def insert_requisition_log(payload: dict) -> dict:
    data = clean_payload(payload)
    with connect() as connection:
        if data["status"] not in {"ongoing", "filled", "cancel"}:
            raise ValueError("Status must be ongoing, filled, or cancel.")
        connection.execute(
            """
            INSERT INTO requisition_logs (doc_id, log_date, status, remark)
            VALUES (?, ?, ?, ?)
            """,
            (data["doc_id"], data["log_date"], data["status"], data.get("remark")),
        )
        old_data = row_to_dict(connection.execute("SELECT * FROM requisitions WHERE doc_id = ?", (data["doc_id"],)).fetchone())
        connection.execute(
            "UPDATE requisitions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE doc_id = ?",
            (data["status"], data["doc_id"]),
        )
        update_requisition_status(connection, data["doc_id"])
        new_data = row_to_dict(connection.execute("SELECT * FROM requisitions WHERE doc_id = ?", (data["doc_id"],)).fetchone())
        log_change(connection, "requisitions", data["doc_id"], "status", old_data, new_data)
    return {"ok": True}


def upsert_group(payload: dict) -> dict:
    data = clean_payload(payload)
    mode = require_mode(data)
    with connect() as connection:
        group_id = data.get("group_id")
        if mode == "new":
            group_id = next_id(connection, "position_groups", "group_id", "GRP")
        elif not group_id:
            raise ValueError("Group ID is required in Change mode.")

        existing = row_to_dict(connection.execute("SELECT * FROM position_groups WHERE group_id = ?", (group_id,)).fetchone())
        if mode == "new" and existing is not None:
            raise ValueError("Group ID already exists. Switch to Change mode to edit it.")
        if mode == "change" and existing is None:
            raise ValueError("Group ID does not exist. Switch to New mode to create it.")

        connection.execute(
            """
            INSERT INTO position_groups (
              group_id, group_position, channel_fb,
              channel_jobthai, channel_jobtopgun, channel_jobdb
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(group_id) DO UPDATE SET
              group_position = excluded.group_position,
              channel_fb = excluded.channel_fb,
              channel_jobthai = excluded.channel_jobthai,
              channel_jobtopgun = excluded.channel_jobtopgun,
              channel_jobdb = excluded.channel_jobdb,
              updated_at = CURRENT_TIMESTAMP
            """,
            (
                group_id,
                data["group_position"],
                int(bool(data.get("channel_fb"))),
                int(bool(data.get("channel_jobthai"))),
                int(bool(data.get("channel_jobtopgun"))),
                int(bool(data.get("channel_jobdb"))),
            ),
        )
        new_data = row_to_dict(connection.execute("SELECT * FROM position_groups WHERE group_id = ?", (group_id,)).fetchone())
        log_change(connection, "position_groups", group_id, mode, existing, new_data)
    return {"ok": True, "group_id": group_id}


def create_group_match(payload: dict) -> dict:
    data = clean_payload(payload)
    with connect() as connection:
        group = connection.execute("SELECT * FROM position_groups WHERE group_id = ?", (data["group_id"],)).fetchone()
        if group is None:
            raise ValueError("Group ID does not exist.")

        existing = connection.execute(
            """
            SELECT *
            FROM document_groups
            WHERE doc_id = ? AND group_id = ?
            """,
            (data["doc_id"], data["group_id"]),
        ).fetchone()
        if existing is not None:
            raise ValueError("This requisition is already matched to that group.")

        doc_group_id = next_id(connection, "document_groups", "doc_group_id", "DGRP")
        connection.execute(
            """
            INSERT INTO document_groups (
              doc_group_id, doc_id, group_id, group_position,
              channel_fb, channel_jobthai, channel_jobtopgun, channel_jobdb
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                doc_group_id,
                data["doc_id"],
                data["group_id"],
                group["group_position"],
                group["channel_fb"],
                group["channel_jobthai"],
                group["channel_jobtopgun"],
                group["channel_jobdb"],
            ),
        )
        new_data = row_to_dict(connection.execute("SELECT * FROM document_groups WHERE doc_group_id = ?", (doc_group_id,)).fetchone())
        log_change(connection, "document_groups", doc_group_id, "new", None, new_data)
    return {"ok": True, "doc_group_id": doc_group_id}


def upsert_candidate(payload: dict) -> dict:
    data = clean_payload(payload)
    mode = require_mode(data)
    with connect() as connection:
        candidate_id = data.get("candidate_id")
        if mode == "new":
            candidate_id = next_id(connection, "candidates", "candidate_id", "CAN")
        elif not candidate_id:
            raise ValueError("Candidate ID is required in Change mode.")

        existing = row_to_dict(connection.execute("SELECT * FROM candidates WHERE candidate_id = ?", (candidate_id,)).fetchone())
        if mode == "new" and existing is not None:
            raise ValueError("Candidate ID already exists. Switch to Change mode to edit it.")
        if mode == "change" and existing is None:
            raise ValueError("Candidate ID does not exist. Switch to New mode to create it.")

        connection.execute(
            """
            INSERT INTO candidates (
              candidate_id, name, phone_no, doc_group_id, channel, ref_name, first_contact_date
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(candidate_id) DO UPDATE SET
              name = excluded.name,
              phone_no = excluded.phone_no,
              doc_group_id = excluded.doc_group_id,
              channel = excluded.channel,
              ref_name = excluded.ref_name,
              first_contact_date = excluded.first_contact_date,
              updated_at = CURRENT_TIMESTAMP
            """,
            (
                candidate_id,
                data["name"],
                data.get("phone_no"),
                data["doc_group_id"],
                data.get("channel"),
                data.get("ref_name"),
                data.get("first_contact_date"),
            ),
        )
        new_data = row_to_dict(connection.execute("SELECT * FROM candidates WHERE candidate_id = ?", (candidate_id,)).fetchone())
        log_change(connection, "candidates", candidate_id, mode, existing, new_data)
    return {"ok": True, "candidate_id": candidate_id}


def insert_recruitment_log(payload: dict) -> dict:
    data = clean_payload(payload)
    result = data.get("result")
    with connect() as connection:
        connection.execute(
            """
            INSERT INTO recruitment_logs (
              candidate_id, log_date, recruitment_process, round, interviewer, result, remark
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["candidate_id"],
                data["log_date"],
                data["recruitment_process"],
                int(data.get("round") or 1),
                data.get("interviewer"),
                None if result is None else int(result),
                data.get("remark"),
            ),
        )
        connection.execute(
            """
            UPDATE candidates
            SET updated_at = CURRENT_TIMESTAMP
            WHERE candidate_id = ?
            """,
            (data["candidate_id"],),
        )
        new_data = row_to_dict(
            connection.execute("SELECT * FROM recruitment_logs WHERE log_id = last_insert_rowid()").fetchone()
        )
        log_change(connection, "recruitment_logs", str(new_data["log_id"]), "new", None, new_data)
    return {"ok": True}


def upsert_offer(payload: dict) -> dict:
    data = clean_payload(payload)
    mode = require_mode(data)
    with connect() as connection:
        existing = row_to_dict(
            connection.execute(
                """
                SELECT *
                FROM offers
                WHERE candidate_id = ? AND doc_id = ?
                """,
                (data["candidate_id"], data["doc_id"]),
            ).fetchone()
        )
        if mode == "new" and existing is not None:
            raise ValueError("This offer already exists. Switch to Change mode to edit it.")
        if mode == "change" and existing is None:
            raise ValueError("This offer does not exist. Switch to New mode to create it.")

        connection.execute(
            """
            INSERT INTO offers (
              candidate_id, doc_id, accepted_date, first_working_date,
              offered_type, replaced, remark
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(candidate_id, doc_id) DO UPDATE SET
              accepted_date = excluded.accepted_date,
              first_working_date = excluded.first_working_date,
              offered_type = excluded.offered_type,
              replaced = excluded.replaced,
              remark = excluded.remark,
              updated_at = CURRENT_TIMESTAMP
            """,
            (
                data["candidate_id"],
                data["doc_id"],
                data.get("accepted_date"),
                data.get("first_working_date"),
                data.get("offered_type"),
                data.get("replaced"),
                data.get("remark"),
            ),
        )
        new_data = row_to_dict(
            connection.execute(
                """
                SELECT *
                FROM offers
                WHERE candidate_id = ? AND doc_id = ?
                """,
                (data["candidate_id"], data["doc_id"]),
            ).fetchone()
        )
        log_change(connection, "offers", f"{data['candidate_id']}|{data['doc_id']}", mode, existing, new_data)
        update_requisition_status(connection, data["doc_id"])
    return {"ok": True}


POST_ROUTES = {
    "/api/requisitions": upsert_requisition,
    "/api/requisition-logs": insert_requisition_log,
    "/api/groups": upsert_group,
    "/api/group-matches": create_group_match,
    "/api/candidates": upsert_candidate,
    "/api/recruitment-logs": insert_recruitment_log,
    "/api/offers": upsert_offer,
}


class RecruitmentHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def do_GET(self) -> None:
        parsed_url = urlparse(self.path)

        if parsed_url.path == "/api/dashboard":
            self.send_json(get_dashboard())
            return

        if parsed_url.path == "/":
            self.path = "/index.html"

        super().do_GET()

    def do_POST(self) -> None:
        parsed_url = urlparse(self.path)
        handler = POST_ROUTES.get(parsed_url.path)

        if handler is None:
            self.send_json({"error": "Route not found."}, status=404)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            self.send_json(handler(payload))
        except sqlite3.IntegrityError as error:
            self.send_json({"error": str(error)}, status=400)
        except (KeyError, ValueError, json.JSONDecodeError) as error:
            self.send_json({"error": f"Invalid request: {error}"}, status=400)

    def send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    init_db()
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8010"))
    server = ThreadingHTTPServer((host, port), RecruitmentHandler)
    print(f"Recruitment tracking site running at http://{host}:{port}")
    print("Press Ctrl+C to stop.")
    server.serve_forever()


if __name__ == "__main__":
    main()
