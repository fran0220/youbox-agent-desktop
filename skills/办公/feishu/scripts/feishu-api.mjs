#!/usr/bin/env node
/**
 * Feishu (Lark) API client v1.0 — JAcoworks skill script
 * Zero external dependencies — Node.js 18+ built-ins only.
 *
 * Usage: node feishu-api.mjs <command> [options]
 *
 * Commands:
 *   send-text        Send a text message
 *   send-card        Send an interactive card
 *   reply            Reply to a message
 *   calendar-list    List calendar events
 *   create-event     Create a calendar event
 *   freebusy         Query free/busy times
 *   list-rooms       List meeting rooms
 *   contact-search   Search users
 *   department-list  List departments
 *   approval-create  Create an approval instance
 *   approval-get     Get approval details
 *   approval-list    List approval instances
 *   bitable-query    Query bitable records
 *   bitable-add      Add bitable records
 *   bitable-update   Update a bitable record
 *
 * Env: FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_BASE_URL (optional)
 */

// ---------------------------------------------------------------------------
// Constants & token cache
// ---------------------------------------------------------------------------
const BASE_URL = (process.env.FEISHU_BASE_URL || "https://open.feishu.cn/open-apis").replace(/\/+$/, "");
const APP_ID = process.env.FEISHU_APP_ID || "";
const APP_SECRET = process.env.FEISHU_APP_SECRET || "";
const TIMEOUT_MS = 15_000;

let _tokenCache = "";
let _tokenExpiry = 0; // epoch ms

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------
async function getTenantToken() {
  if (_tokenCache && Date.now() < _tokenExpiry) return _tokenCache;

  if (!APP_ID || !APP_SECRET) {
    throw new Error("FEISHU_APP_ID and FEISHU_APP_SECRET must be set");
  }

  const res = await fetch(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`Token request failed: HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`Token error: code=${data.code}, msg=${data.msg || ""}`);
  }

  _tokenCache = data.tenant_access_token;
  // Refresh 5 minutes early to be safe
  _tokenExpiry = Date.now() + (data.expire - 300) * 1000;
  console.error(`[feishu] token acquired, expires in ${data.expire}s`);
  return _tokenCache;
}

// ---------------------------------------------------------------------------
// Central API helper
// ---------------------------------------------------------------------------
async function feishuRequest(method, path, body = null, query = null) {
  const token = await getTenantToken();
  let url = `${BASE_URL}${path}`;
  if (query) {
    const qs = new URLSearchParams(query).toString();
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  }

  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  };
  if (body !== null && method !== "GET") {
    opts.body = JSON.stringify(body);
  }

  console.error(`[feishu] ${method} ${url}`);
  const res = await fetch(url, opts);
  const data = await res.json();

  if (data.code && data.code !== 0) {
    return { error: true, code: data.code, message: data.msg || "Unknown error" };
  }
  return data;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isoToUnix(iso) {
  const ms = Date.parse(iso);
  if (isNaN(ms)) throw new Error(`Invalid datetime: ${iso}`);
  return Math.floor(ms / 1000);
}

function isoToUnixStr(iso) {
  return String(isoToUnix(iso));
}

function isError(data) {
  return data && data.error === true;
}

// ---------------------------------------------------------------------------
// 1. send-text
// ---------------------------------------------------------------------------
async function cmdSendText(args) {
  const to = args.to;
  const idType = args["id-type"] || "open_id";
  const text = args.text;
  if (!to || !text) throw new Error("--to and --text are required");

  const data = await feishuRequest("POST", "/im/v1/messages", {
    receive_id: to,
    msg_type: "text",
    content: JSON.stringify({ text }),
  }, { receive_id_type: idType });

  return { command: "send-text", ...data };
}

// ---------------------------------------------------------------------------
// 2. send-card
// ---------------------------------------------------------------------------
async function cmdSendCard(args) {
  const to = args.to;
  const idType = args["id-type"] || "open_id";
  const card = args.card;
  if (!to || !card) throw new Error("--to and --card are required");

  const data = await feishuRequest("POST", "/im/v1/messages", {
    receive_id: to,
    msg_type: "interactive",
    content: card,
  }, { receive_id_type: idType });

  return { command: "send-card", ...data };
}

// ---------------------------------------------------------------------------
// 3. reply
// ---------------------------------------------------------------------------
async function cmdReply(args) {
  const messageId = args["message-id"];
  const text = args.text;
  if (!messageId || !text) throw new Error("--message-id and --text are required");

  const data = await feishuRequest("POST", `/im/v1/messages/${messageId}/reply`, {
    msg_type: "text",
    content: JSON.stringify({ text }),
  });

  return { command: "reply", ...data };
}

// ---------------------------------------------------------------------------
// 4. calendar-list
// ---------------------------------------------------------------------------
async function cmdCalendarList(args) {
  const start = args.start;
  const end = args.end;
  if (!start || !end) throw new Error("--start and --end are required (ISO datetime)");

  // Step 1: Find the primary calendar
  const calRes = await feishuRequest("GET", "/calendar/v4/calendars", null, { page_size: "50" });
  if (isError(calRes)) return { command: "calendar-list", ...calRes };

  const calendars = calRes.data?.calendar_list || [];
  const primary = calendars.find(c => c.type === "primary") || calendars[0];
  if (!primary) {
    return { command: "calendar-list", error: true, code: -1, message: "No accessible calendar found" };
  }

  // Step 2: List events
  const calendarId = primary.calendar_id;
  const evtRes = await feishuRequest("GET", `/calendar/v4/calendars/${calendarId}/events`, null, {
    start_time: isoToUnixStr(start),
    end_time: isoToUnixStr(end),
    page_size: "50",
  });
  if (isError(evtRes)) return { command: "calendar-list", ...evtRes };

  const events = (evtRes.data?.items || []).map(e => ({
    event_id: e.event_id,
    summary: e.summary,
    start_time: e.start_time,
    end_time: e.end_time,
    status: e.status,
    attendees_count: (e.attendees || []).length,
    location: e.location?.name || null,
  }));

  return {
    command: "calendar-list",
    calendar_id: calendarId,
    calendar_summary: primary.summary || primary.calendar_id,
    count: events.length,
    events,
  };
}

// ---------------------------------------------------------------------------
// 5. create-event
// ---------------------------------------------------------------------------
async function cmdCreateEvent(args) {
  const summary = args.summary;
  const start = args.start;
  const end = args.end;
  if (!summary || !start || !end) throw new Error("--summary, --start, --end are required");

  // Find primary calendar
  const calRes = await feishuRequest("GET", "/calendar/v4/calendars", null, { page_size: "50" });
  if (isError(calRes)) return { command: "create-event", ...calRes };

  const calendars = calRes.data?.calendar_list || [];
  const primary = calendars.find(c => c.type === "primary") || calendars[0];
  if (!primary) {
    return { command: "create-event", error: true, code: -1, message: "No accessible calendar found" };
  }

  const body = {
    summary,
    start_time: { timestamp: isoToUnixStr(start) },
    end_time: { timestamp: isoToUnixStr(end) },
  };

  if (args.description) body.description = args.description;

  // Attendees
  const attendees = [];
  if (args.attendees) {
    for (const id of args.attendees.split(",")) {
      attendees.push({ type: "user", user_id: id.trim(), is_optional: false });
    }
  }
  if (args.room) {
    attendees.push({ type: "resource", room_id: args.room });
  }
  if (attendees.length > 0) body.attendees = attendees;

  const data = await feishuRequest("POST", `/calendar/v4/calendars/${primary.calendar_id}/events`, body);
  return { command: "create-event", ...data };
}

// ---------------------------------------------------------------------------
// 6. freebusy
// ---------------------------------------------------------------------------
async function cmdFreebusy(args) {
  const users = args.users;
  const start = args.start;
  const end = args.end;
  if (!users || !start || !end) throw new Error("--users, --start, --end are required");

  const userIdList = users.split(",").map(id => ({
    user_id: id.trim(),
    type: "open_id",
  }));

  const data = await feishuRequest("POST", "/calendar/v4/freebusy/list", {
    time_min: new Date(start).toISOString(),
    time_max: new Date(end).toISOString(),
    user_id_list: userIdList,
  });

  return { command: "freebusy", ...data };
}

// ---------------------------------------------------------------------------
// 7. list-rooms
// ---------------------------------------------------------------------------
async function cmdListRooms(args) {
  const buildingId = args.building;

  if (buildingId) {
    // List rooms in a specific building
    const data = await feishuRequest("GET", "/meeting_room/v1/room/list", null, {
      building_id: buildingId,
      page_size: "100",
    });
    if (isError(data)) {
      // Fallback: try resource calendars
      return await listRoomsFallback();
    }
    return { command: "list-rooms", building_id: buildingId, ...data };
  }

  // List buildings first
  const bldRes = await feishuRequest("GET", "/meeting_room/v1/building/list", null, { page_size: "100" });
  if (isError(bldRes)) {
    // Fallback: list resource-type calendars
    return await listRoomsFallback();
  }

  return { command: "list-rooms", ...bldRes };
}

async function listRoomsFallback() {
  console.error("[feishu] Falling back to resource calendar listing");
  const data = await feishuRequest("GET", "/calendar/v4/calendars", null, { page_size: "50" });
  if (isError(data)) return { command: "list-rooms", ...data };

  const rooms = (data.data?.calendar_list || [])
    .filter(c => c.type === "resource")
    .map(c => ({
      calendar_id: c.calendar_id,
      summary: c.summary,
      description: c.description || null,
    }));

  return { command: "list-rooms", method: "calendar-fallback", count: rooms.length, rooms };
}

// ---------------------------------------------------------------------------
// 8. contact-search
// ---------------------------------------------------------------------------
async function cmdContactSearch(args) {
  const query = args.query;
  if (!query) throw new Error("--query is required");

  // Try search API first
  const searchRes = await feishuRequest("POST", "/search/v1/user", { query, page_size: 20 });
  if (!isError(searchRes)) {
    const items = (searchRes.data?.items || []).map(u => ({
      open_id: u.open_id,
      name: u.name,
      en_name: u.en_name || null,
      department_ids: u.department_ids || [],
      avatar_url: u.avatar?.avatar_72 || null,
    }));
    return { command: "contact-search", method: "search", count: items.length, users: items };
  }

  console.error("[feishu] Search API failed, falling back to department listing");

  // Fallback: list root department and filter client-side
  const listRes = await feishuRequest("GET", "/contact/v3/users", null, {
    department_id: "0",
    page_size: "50",
  });
  if (isError(listRes)) return { command: "contact-search", ...listRes };

  const lowerQ = query.toLowerCase();
  const filtered = (listRes.data?.items || [])
    .filter(u => {
      const name = (u.name || "").toLowerCase();
      const enName = (u.en_name || "").toLowerCase();
      return name.includes(lowerQ) || enName.includes(lowerQ);
    })
    .map(u => ({
      open_id: u.open_id,
      name: u.name,
      en_name: u.en_name || null,
      department_ids: u.department_ids || [],
      avatar_url: u.avatar?.avatar_72 || null,
    }));

  return { command: "contact-search", method: "department-filter", count: filtered.length, users: filtered };
}

// ---------------------------------------------------------------------------
// 9. department-list
// ---------------------------------------------------------------------------
async function cmdDepartmentList(args) {
  const parentId = args.parent || "0";

  const data = await feishuRequest("GET", "/contact/v3/departments", null, {
    parent_department_id: parentId,
    page_size: "50",
  });

  if (isError(data)) return { command: "department-list", ...data };

  const departments = (data.data?.items || []).map(d => ({
    department_id: d.department_id,
    open_department_id: d.open_department_id,
    name: d.name,
    parent_department_id: d.parent_department_id,
    member_count: d.member_count || 0,
  }));

  return { command: "department-list", parent: parentId, count: departments.length, departments };
}

// ---------------------------------------------------------------------------
// 10. approval-create
// ---------------------------------------------------------------------------
async function cmdApprovalCreate(args) {
  const code = args.code;
  const user = args.user;
  const form = args.form;
  if (!code || !user || !form) throw new Error("--code, --user, --form are required");

  const data = await feishuRequest("POST", "/approval/v4/instances", {
    approval_code: code,
    open_id: user,
    form,
  });

  return { command: "approval-create", ...data };
}

// ---------------------------------------------------------------------------
// 11. approval-get
// ---------------------------------------------------------------------------
async function cmdApprovalGet(args) {
  const instance = args.instance;
  if (!instance) throw new Error("--instance is required");

  const data = await feishuRequest("GET", `/approval/v4/instances/${instance}`);
  return { command: "approval-get", ...data };
}

// ---------------------------------------------------------------------------
// 12. approval-list
// ---------------------------------------------------------------------------
async function cmdApprovalList(args) {
  const user = args.user;
  if (!user) throw new Error("--user is required");

  const body = {
    user_id: user,
    page_size: 20,
  };
  if (args.code) body.approval_code = args.code;
  if (args.status && args.status !== "ALL") body.status = args.status;

  const data = await feishuRequest("POST", "/approval/v4/instances/query", body);

  if (isError(data)) return { command: "approval-list", ...data };

  const instances = (data.data?.instance_list || []).map(inst => ({
    instance_code: inst.instance_code,
    approval_code: inst.approval_code,
    status: inst.status,
    start_time: inst.start_time,
    end_time: inst.end_time || null,
  }));

  return { command: "approval-list", count: instances.length, instances };
}

// ---------------------------------------------------------------------------
// 13. bitable-query
// ---------------------------------------------------------------------------
async function cmdBitableQuery(args) {
  const app = args.app;
  const table = args.table;
  if (!app || !table) throw new Error("--app and --table are required");

  const pageSize = args["page-size"] || "20";
  let data;

  if (args.filter) {
    // Use search API with filter
    let filterObj;
    try {
      filterObj = JSON.parse(args.filter);
    } catch {
      throw new Error("--filter must be valid JSON");
    }
    data = await feishuRequest("POST",
      `/bitable/v1/apps/${app}/tables/${table}/records/search`,
      { ...filterObj, page_size: parseInt(pageSize) },
    );
  } else {
    data = await feishuRequest("GET",
      `/bitable/v1/apps/${app}/tables/${table}/records`,
      null,
      { page_size: pageSize },
    );
  }

  if (isError(data)) return { command: "bitable-query", ...data };

  const records = (data.data?.items || []).map(r => ({
    record_id: r.record_id,
    fields: r.fields,
  }));

  return {
    command: "bitable-query",
    app_token: app,
    table_id: table,
    total: data.data?.total || records.length,
    count: records.length,
    has_more: data.data?.has_more || false,
    records,
  };
}

// ---------------------------------------------------------------------------
// 14. bitable-add
// ---------------------------------------------------------------------------
async function cmdBitableAdd(args) {
  const app = args.app;
  const table = args.table;
  const records = args.records;
  if (!app || !table || !records) throw new Error("--app, --table, --records are required");

  let recordArr;
  try {
    recordArr = JSON.parse(records);
  } catch {
    throw new Error("--records must be valid JSON array");
  }
  if (!Array.isArray(recordArr)) throw new Error("--records must be a JSON array");

  const body = {
    records: recordArr.map(r => ({ fields: r.fields || r })),
  };

  const data = await feishuRequest("POST",
    `/bitable/v1/apps/${app}/tables/${table}/records/batch_create`,
    body,
  );

  return { command: "bitable-add", ...data };
}

// ---------------------------------------------------------------------------
// 15. bitable-update
// ---------------------------------------------------------------------------
async function cmdBitableUpdate(args) {
  const app = args.app;
  const table = args.table;
  const record = args.record;
  const fields = args.fields;
  if (!app || !table || !record || !fields) {
    throw new Error("--app, --table, --record, --fields are required");
  }

  let fieldsObj;
  try {
    fieldsObj = JSON.parse(fields);
  } catch {
    throw new Error("--fields must be valid JSON");
  }

  const data = await feishuRequest("PUT",
    `/bitable/v1/apps/${app}/tables/${table}/records/${record}`,
    { fields: fieldsObj },
  );

  return { command: "bitable-update", ...data };
}

// ---------------------------------------------------------------------------
// CLI arg parsing — manual, matching search.mjs pattern
// ---------------------------------------------------------------------------
function parseCliArgs() {
  const raw = process.argv.slice(2);
  if (raw.length === 0) {
    printUsage();
    process.exit(1);
  }

  const command = raw[0];
  if (command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  const args = {};
  let i = 1;
  while (i < raw.length) {
    const arg = raw[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      // Peek next: if missing or another flag, treat as boolean
      if (i + 1 >= raw.length || raw[i + 1].startsWith("--")) {
        args[key] = true;
        i++;
      } else {
        args[key] = raw[i + 1];
        i += 2;
      }
    } else {
      i++;
    }
  }

  return { command, args };
}

function printUsage() {
  console.error(`Feishu API Client v1.0

Usage: node feishu-api.mjs <command> [options]

Commands:
  send-text        --to <id> --text "msg" [--id-type open_id|chat_id]
  send-card        --to <id> --card '<json>' [--id-type open_id|chat_id]
  reply            --message-id <id> --text "msg"
  calendar-list    --start <ISO> --end <ISO>
  create-event     --summary "title" --start <ISO> --end <ISO>
                   [--attendees id1,id2] [--room <id>] [--description "desc"]
  freebusy         --users <id1,id2> --start <ISO> --end <ISO>
  list-rooms       [--building <id>]
  contact-search   --query "name"
  department-list  [--parent <department_id>]
  approval-create  --code <code> --user <open_id> --form '<json>'
  approval-get     --instance <instance_code>
  approval-list    --user <open_id> [--status PENDING|APPROVED|REJECTED] [--code <code>]
  bitable-query    --app <token> --table <id> [--filter '<json>'] [--page-size 20]
  bitable-add      --app <token> --table <id> --records '<json_array>'
  bitable-update   --app <token> --table <id> --record <id> --fields '<json>'

Environment:
  FEISHU_APP_ID      Feishu app ID
  FEISHU_APP_SECRET  Feishu app secret
  FEISHU_BASE_URL    API base (default: https://open.feishu.cn/open-apis)`);
}

// ---------------------------------------------------------------------------
// Command dispatcher
// ---------------------------------------------------------------------------
const COMMANDS = {
  "send-text":       cmdSendText,
  "send-card":       cmdSendCard,
  "reply":           cmdReply,
  "calendar-list":   cmdCalendarList,
  "create-event":    cmdCreateEvent,
  "freebusy":        cmdFreebusy,
  "list-rooms":      cmdListRooms,
  "contact-search":  cmdContactSearch,
  "department-list": cmdDepartmentList,
  "approval-create": cmdApprovalCreate,
  "approval-get":    cmdApprovalGet,
  "approval-list":   cmdApprovalList,
  "bitable-query":   cmdBitableQuery,
  "bitable-add":     cmdBitableAdd,
  "bitable-update":  cmdBitableUpdate,
};

async function main() {
  const { command, args } = parseCliArgs();

  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }

  try {
    const result = await handler(args);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    const output = { error: true, code: -1, message: err.message || String(err) };
    console.log(JSON.stringify(output, null, 2));
    process.exit(1);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
