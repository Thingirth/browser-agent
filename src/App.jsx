import { useState, useRef, useEffect, useCallback } from "react";

const TOOLS = [
  {
    type: "function",
    function: {
      name: "navigate",
      description: "Navigate the browser to a URL",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "click",
      description: "Click an element by CSS selector or visible text",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string" },
          description: { type: "string" }
        },
        required: ["selector", "description"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "type_slow",
      description: "Type text slowly with human-like delays to avoid bot detection. Use this for ALL login fields.",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string" },
          text: { type: "string" },
          description: { type: "string" }
        },
        required: ["selector", "text", "description"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "screenshot",
      description: "Take a screenshot to see the current browser state",
      parameters: {
        type: "object",
        properties: { description: { type: "string" } },
        required: ["description"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "wait",
      description: "Wait for a number of seconds for page to load",
      parameters: {
        type: "object",
        properties: {
          seconds: { type: "number" },
          description: { type: "string" }
        },
        required: ["seconds", "description"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "extract",
      description: "Extract all text content from the progress note area",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string" },
          description: { type: "string" }
        },
        required: ["selector", "description"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "scroll",
      description: "Scroll the page or an element",
      parameters: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["up", "down"] },
          amount: { type: "number" }
        },
        required: ["direction", "amount"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "press_key",
      description: "Press a keyboard key like Enter, Tab, Escape",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Key to press e.g. Enter, Tab, Escape" },
          description: { type: "string" }
        },
        required: ["key", "description"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "task_complete",
      description: "Mark task as complete and return extracted notes",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          notes: { type: "string" },
          success: { type: "boolean" }
        },
        required: ["summary", "success"]
      }
    }
  }
];

const buildSystemPrompt = (ecwUrl, username, password, patientName) => `You are a clinical workflow automation agent helping authorized medical staff retrieve patient notes from eClinicalWorks v12.

CREDENTIALS (never display these in your responses):
- eCW URL: ${ecwUrl}
- Username: ${username}  
- Password: ${password}
- Patient to look up: ${patientName}

EXACT LOGIN WORKFLOW FOR eCW v12:
1. Navigate to the eCW URL
2. Wait 2 seconds
3. Take a screenshot to confirm the login page loaded
4. Use type_slow on the username field with selector: input[type="text"]
5. Wait 1 second
6. Press Enter using press_key tool with key "Enter" — this submits the username form
7. Wait 3 seconds for password screen to load
8. Take a screenshot to confirm password screen loaded (you should see input[type="password"])
9. Use type_slow on the password field with selector: input[type="password"]
10. Wait 1 second
11. Press Enter using press_key tool with key "Enter" — this submits the password
12. Wait 5 seconds for dashboard to load
13. Take a screenshot — you may see a DISCLAIMER popup with "I AGREE" button
14. If disclaimer visible, click "I AGREE" using selector: button.agreeBtn, or text "I AGREE"
15. Wait 3 seconds
16. Take a screenshot to confirm you are on the eCW dashboard

PATIENT SEARCH WORKFLOW:
17. Look for a patient search icon or magnifying glass at the top of the page
    - Try clicking the search/magnifying glass icon in the top navigation
    - Or look for a patient name field at the top
    - In eCW v12, there is often a search bar or "F2" shortcut for patient lookup
18. Take a screenshot to see what appeared
19. If a Patient Lookup modal appeared, type the patient last name in the "Last Name, First Name" field
    The selector for this field is typically: input[placeholder*="Last Name"], or the first input in the modal
20. Click the Search button or press Enter
21. Wait 2 seconds
22. Take a screenshot to see the search results
23. Click on the correct patient row matching "${patientName}"
24. Wait 3 seconds
25. Take a screenshot to see the patient chart

EXTRACTING PROGRESS NOTES:
26. Click on "Progress Note" tab if not already selected
27. Take a screenshot to see the progress note content
28. Extract the text from the main content area. Try these selectors:
    - .progressNoteContent
    - #progressNoteDiv  
    - .soap-note
    - div[class*="progress"]
    - .note-content
    - Try extract with selector "body" to get all visible text if specific selectors fail
29. Scroll down and extract more if needed
30. Call task_complete with ALL extracted note text in the "notes" field

IMPORTANT RULES:
- Always use type_slow (never regular type) for username and password fields
- Add wait steps between actions to appear human-like
- Take a screenshot after every major action to confirm what happened
- If you see a Cloudflare challenge, wait 5 seconds and take a screenshot
- Never include credentials in your thinking responses
- The patient lookup in eCW v12 may require clicking a specific icon - look at the screenshot carefully
- If you see "Patient Hub" panel on the right, the patient is selected - look for Progress Notes there`;

const TOOL_ICONS = {
  navigate: "🌐", click: "👆", type_slow: "⌨️", screenshot: "📷",
  scroll: "↕️", extract: "📋", wait: "⏳", press_key: "↵", task_complete: "✅"
};
const TOOL_COLORS = {
  navigate: "#3b82f6", click: "#8b5cf6", type_slow: "#10b981", screenshot: "#f59e0b",
  scroll: "#6b7280", extract: "#ef4444", wait: "#6b7280", press_key: "#06b6d4", task_complete: "#10b981"
};

export default function ECWAgent() {
  const [screen, setScreen] = useState("disclaimer");
  const [openaiKey, setOpenaiKey] = useState("");
  const [backendUrl, setBackendUrl] = useState("");
  const [ecwUrl, setEcwUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [patientName, setPatientName] = useState("");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState([]);
  const [extractedNotes, setExtractedNotes] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");
  const [agentStatus, setAgentStatus] = useState("idle");
  const stepsEndRef = useRef(null);
  const abortRef = useRef(false);
  const sessionId = useRef("session_" + Date.now());

  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps]);

  const addStep = useCallback((step) => {
    setSteps(prev => [...prev, { ...step, id: Date.now() + Math.random() }]);
  }, []);

  async function executeTool(tool, input) {
    const response = await fetch(`${backendUrl}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sessionId.current, tool, input })
    });
    const data = await response.json();
    return data.result;
  }

  const runAgent = async () => {
    if (!patientName.trim() || running) return;
    abortRef.current = false;
    setRunning(true);
    setSteps([]);
    setExtractedNotes("");
    setCurrentUrl("");
    setAgentStatus("thinking");
    sessionId.current = "session_" + Date.now();

    const task = `Log into eCW and retrieve the progress notes for patient: ${patientName}`;

    const messages = [
      { role: "system", content: buildSystemPrompt(ecwUrl, username, password, patientName) },
      { role: "user", content: task }
    ];

    let iterCount = 0;
    const MAX_ITER = 40;

    addStep({ type: "task", content: `Looking up patient: ${patientName}` });

    try {
      while (iterCount < MAX_ITER && !abortRef.current) {
        iterCount++;
        setAgentStatus("thinking");

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${openaiKey.trim()}`
          },
          body: JSON.stringify({
            model: "gpt-4o",
            max_tokens: 1500,
            messages,
            tools: TOOLS,
            tool_choice: "auto"
          })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error.message);

        const message = data.choices[0].message;
        messages.push(message);

        if (message.content?.trim()) {
          const safeContent = message.content
            .replace(new RegExp(password.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '***')
            .replace(new RegExp(username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '***');
          addStep({ type: "thought", content: safeContent });
        }

        if (!message.tool_calls || message.tool_calls.length === 0) {
          addStep({ type: "done", content: message.content || "Task complete." });
          break;
        }

        setAgentStatus("acting");

        for (const toolCall of message.tool_calls) {
          if (abortRef.current) break;

          const toolName = toolCall.function.name;
          let toolInput = {};
          try { toolInput = JSON.parse(toolCall.function.arguments); } catch {}

          // Mask credentials in UI
          const safeInput = { ...toolInput };
          if (safeInput.text === password) safeInput.text = "***";
          if (safeInput.text === username) safeInput.text = "***";

          addStep({ type: "tool", tool: toolName, input: safeInput });

          const result = await executeTool(toolName, toolInput);

          if (toolName === "screenshot" && typeof result === "string" && result.startsWith("data:image")) {
            addStep({ type: "screenshot", image: result });
            messages.push({ role: "tool", tool_call_id: toolCall.id, content: "Screenshot taken." });
            messages.push({
              role: "user",
              content: [
                { type: "text", text: "Current browser screenshot — analyze carefully to determine next action:" },
                { type: "image_url", image_url: { url: result, detail: "high" } }
              ]
            });
          } else {
            const safeResult = typeof result === "string"
              ? result.replace(new RegExp(password.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '***')
              : String(result);
            addStep({ type: "tool_result", tool: toolName, result: safeResult });
            messages.push({ role: "tool", tool_call_id: toolCall.id, content: String(result) });
          }

          if (toolName === "navigate") setCurrentUrl(toolInput.url);

          if (toolName === "task_complete") {
            if (toolInput.notes) setExtractedNotes(toolInput.notes);
            setAgentStatus("complete");
            setRunning(false);
            return;
          }
        }

        if (data.choices[0].finish_reason === "stop") break;
      }
    } catch (err) {
      addStep({ type: "error", content: `Error: ${err.message}` });
    }

    setAgentStatus(abortRef.current ? "stopped" : "complete");
    setRunning(false);
  };

  const stopAgent = () => {
    abortRef.current = true;
    setRunning(false);
    setAgentStatus("stopped");
    addStep({ type: "stopped", content: "Agent stopped." });
  };

  const statusColors = {
    idle: "#6b7280", thinking: "#3b82f6", acting: "#8b5cf6",
    complete: "#10b981", stopped: "#f59e0b", error: "#ef4444"
  };
  const statusLabels = {
    idle: "Idle", thinking: "Thinking...", acting: "Acting...",
    complete: "Complete", stopped: "Stopped", error: "Error"
  };

  const inputStyle = {
    width: "100%", padding: "10px 12px", background: "#0a0a0f",
    border: "1px solid #1e293b", borderRadius: 8, color: "#e2e8f0",
    fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box"
  };

  // DISCLAIMER
  if (screen === "disclaimer") {
    return (
      <div style={{
        fontFamily: "'JetBrains Mono', monospace", background: "#0a0a0f",
        minHeight: "100vh", color: "#e2e8f0",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24
      }}>
        <div style={{
          maxWidth: 520, padding: 36, background: "#0d0d14",
          border: "1px solid #dc2626", borderRadius: 12,
          display: "flex", flexDirection: "column", gap: 20
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 36 }}>⚕️</div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", letterSpacing: "0.05em" }}>
                eCW CLINICAL AGENT
              </div>
              <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.1em" }}>
                AUTHORIZED PERSONNEL ONLY · eClinicalWorks v12
              </div>
            </div>
          </div>

          <div style={{
            padding: 16, background: "#1a0a0a", border: "1px solid #dc2626",
            borderRadius: 8, fontSize: 12, color: "#fca5a5", lineHeight: 1.9
          }}>
            <div style={{ fontWeight: 700, marginBottom: 8, color: "#ef4444", fontSize: 13 }}>
              ⚠️ AUTHORIZED USE ONLY — READ BEFORE CONTINUING
            </div>
            By proceeding, you confirm that:<br/>
            • You are a licensed medical professional or authorized staff<br/>
            • You have legitimate authorization to access these patient records<br/>
            • Your use complies with HIPAA and your organization's policies<br/>
            • Patient notes displayed will not be stored or shared inappropriately<br/>
            • You take full responsibility for appropriate use of patient data
          </div>

          <div style={{
            padding: 12, background: "#111827", border: "1px solid #1e293b",
            borderRadius: 8, fontSize: 11, color: "#64748b", lineHeight: 1.7
          }}>
            🔒 Your credentials are transmitted only to your eCW portal and never stored.
            Notes are displayed on screen only and not saved anywhere.
          </div>

          <button
            onClick={() => setScreen("config")}
            style={{
              padding: 14, background: "linear-gradient(135deg, #dc2626, #991b1b)",
              border: "none", borderRadius: 8, color: "white",
              fontSize: 13, fontWeight: 700, cursor: "pointer", letterSpacing: "0.08em"
            }}
          >
            I UNDERSTAND — I AM AUTHORIZED STAFF →
          </button>
        </div>
        <style>{`* { box-sizing: border-box; }`}</style>
      </div>
    );
  }

  // CONFIG
  if (screen === "config") {
    const ready = openaiKey.trim().startsWith("sk-") && backendUrl.trim() && ecwUrl.trim() && username.trim() && password.trim();
    return (
      <div style={{
        fontFamily: "'JetBrains Mono', monospace", background: "#0a0a0f",
        minHeight: "100vh", color: "#e2e8f0",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24
      }}>
        <div style={{
          width: 460, padding: 32, background: "#0d0d14",
          border: "1px solid #1e293b", borderRadius: 12,
          display: "flex", flexDirection: "column", gap: 14
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
            <div style={{ fontSize: 28 }}>⚕️</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9" }}>eCW CLINICAL AGENT</div>
              <div style={{ fontSize: 10, color: "#64748b" }}>SESSION CONFIGURATION</div>
            </div>
          </div>

          {[
            { label: "OPENAI API KEY", val: openaiKey, set: setOpenaiKey, ph: "sk-...", type: "password" },
            { label: "BACKEND URL", val: backendUrl, set: setBackendUrl, ph: "https://your-app.onrender.com", type: "text" },
            { label: "eCW PORTAL URL", val: ecwUrl, set: setEcwUrl, ph: "https://nygemeapp.eclinicalweb.com/...", type: "text" },
            { label: "eCW USERNAME", val: username, set: setUsername, ph: "your.username", type: "text" },
            { label: "eCW PASSWORD", val: password, set: setPassword, ph: "••••••••", type: "password" },
          ].map(({ label, val, set, ph, type }) => (
            <div key={label}>
              <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.12em", marginBottom: 5 }}>{label}</div>
              <input type={type} value={val} onChange={e => set(e.target.value)} placeholder={ph} style={inputStyle} />
            </div>
          ))}

          <button
            onClick={() => setScreen("agent")}
            disabled={!ready}
            style={{
              marginTop: 6, padding: 12,
              background: ready ? "linear-gradient(135deg, #10b981, #3b82f6)" : "#1e293b",
              border: "none", borderRadius: 8, color: ready ? "white" : "#475569",
              fontSize: 13, fontWeight: 700, cursor: ready ? "pointer" : "not-allowed",
              letterSpacing: "0.08em"
            }}
          >
            SAVE & CONTINUE →
          </button>
        </div>
        <style>{`* { box-sizing: border-box; }`}</style>
      </div>
    );
  }

  // AGENT SCREEN
  return (
    <div style={{
      fontFamily: "'JetBrains Mono', monospace", background: "#0a0a0f",
      minHeight: "100vh", color: "#e2e8f0", display: "flex", flexDirection: "column"
    }}>
      {/* Header */}
      <div style={{
        borderBottom: "1px solid #1e293b", padding: "12px 20px",
        display: "flex", alignItems: "center", gap: 12, background: "#0d0d14"
      }}>
        <div style={{ fontSize: 22 }}>⚕️</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9", letterSpacing: "0.05em" }}>eCW CLINICAL AGENT</div>
          <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.08em" }}>AUTHORIZED STAFF · GPT-4o · eClinicalWorks v12</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%",
            background: statusColors[agentStatus],
            boxShadow: `0 0 6px ${statusColors[agentStatus]}`,
            animation: running ? "pulse 1.5s infinite" : "none"
          }} />
          <span style={{ fontSize: 11, color: statusColors[agentStatus] }}>{statusLabels[agentStatus]}</span>
          {currentUrl && (
            <div style={{
              padding: "3px 10px", background: "#1e293b", borderRadius: 20,
              fontSize: 10, color: "#94a3b8", maxWidth: 240,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
            }}>🌐 {currentUrl}</div>
          )}
          <button
            onClick={() => { setScreen("config"); setSteps([]); setExtractedNotes(""); setAgentStatus("idle"); }}
            style={{
              padding: "4px 10px", background: "#1e293b", border: "1px solid #334155",
              borderRadius: 6, color: "#64748b", fontSize: 10, cursor: "pointer"
            }}
          >⚙️ Settings</button>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left Panel */}
        <div style={{
          width: 300, borderRight: "1px solid #1e293b", padding: 16,
          display: "flex", flexDirection: "column", gap: 12,
          background: "#0d0d14", overflowY: "auto"
        }}>
          <div style={{
            padding: 10, background: "#111827", border: "1px solid #1e293b",
            borderRadius: 8, fontSize: 10, color: "#64748b", lineHeight: 1.6
          }}>
            <div style={{ color: "#94a3b8", marginBottom: 3 }}>LOGGED IN AS</div>
            <div style={{ color: "#e2e8f0" }}>{username}</div>
            <div style={{ color: "#64748b", marginTop: 4, fontSize: 9 }}>
              {ecwUrl.replace('https://', '').split('/')[0]}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.12em", marginBottom: 6 }}>
              PATIENT NAME
            </div>
            <input
              type="text"
              value={patientName}
              onChange={e => setPatientName(e.target.value)}
              placeholder="Last, First  or  First Last"
              disabled={running}
              style={inputStyle}
              onKeyDown={e => { if (e.key === "Enter" && patientName.trim()) runAgent(); }}
            />
            <div style={{ fontSize: 9, color: "#334155", marginTop: 4 }}>
              e.g. "Smith, John" or "John Smith"
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={running ? stopAgent : runAgent}
              disabled={!running && !patientName.trim()}
              style={{
                flex: 1, padding: "10px 12px",
                background: running
                  ? "linear-gradient(135deg, #dc2626, #b91c1c)"
                  : "linear-gradient(135deg, #10b981, #3b82f6)",
                border: "none", borderRadius: 8, color: "white",
                fontSize: 12, fontWeight: 700, cursor: "pointer",
                letterSpacing: "0.08em",
                opacity: (!running && !patientName.trim()) ? 0.4 : 1
              }}
            >
              {running ? "⏹ STOP" : "▶ LOOKUP PATIENT"}
            </button>
            {!running && steps.length > 0 && (
              <button
                onClick={() => { setSteps([]); setExtractedNotes(""); setCurrentUrl(""); setAgentStatus("idle"); }}
                style={{
                  padding: "10px 12px", background: "#1e293b",
                  border: "1px solid #334155", borderRadius: 8,
                  color: "#94a3b8", fontSize: 11, cursor: "pointer"
                }}
              >Clear</button>
            )}
          </div>

          <div style={{
            padding: 10, background: "#0a1a0a", border: "1px solid #166534",
            borderRadius: 8, fontSize: 10, color: "#4ade80", lineHeight: 1.7
          }}>
            🔒 Credentials masked in all logs.<br/>
            Notes displayed on screen only.<br/>
            Session closed after each lookup.
          </div>

          <div style={{
            padding: 10, background: "#111827", border: "1px solid #1e293b",
            borderRadius: 8, fontSize: 10, color: "#64748b", lineHeight: 1.7
          }}>
            <div style={{ color: "#f59e0b", marginBottom: 4 }}>ℹ️ HOW IT WORKS</div>
            1. Agent logs into eCW with your credentials<br/>
            2. Searches for the patient you specify<br/>
            3. Opens their chart and reads Progress Notes<br/>
            4. Displays the note text here on screen
          </div>
        </div>

        {/* Right Panel */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Extracted Notes */}
          {extractedNotes && (
            <div style={{
              padding: 16, background: "#0a1a0a", borderBottom: "2px solid #166534",
              maxHeight: "40%", overflowY: "auto", flexShrink: 0
            }}>
              <div style={{
                fontSize: 10, color: "#4ade80", letterSpacing: "0.1em",
                marginBottom: 10, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "space-between"
              }}>
                <span>📋 EXTRACTED PROGRESS NOTES — {patientName.toUpperCase()}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(extractedNotes)}
                  style={{
                    padding: "3px 10px", background: "#166534", border: "none",
                    borderRadius: 4, color: "#4ade80", fontSize: 10, cursor: "pointer"
                  }}
                >Copy</button>
              </div>
              <pre style={{
                whiteSpace: "pre-wrap", fontSize: 12, color: "#e2e8f0",
                lineHeight: 1.8, margin: 0, fontFamily: "inherit"
              }}>
                {extractedNotes}
              </pre>
            </div>
          )}

          {/* Steps Feed */}
          <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            {steps.length === 0 && (
              <div style={{
                flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", color: "#334155", gap: 12
              }}>
                <div style={{ fontSize: 40 }}>⚕️</div>
                <div style={{ fontSize: 13, letterSpacing: "0.1em" }}>READY TO LOOK UP PATIENT</div>
                <div style={{ fontSize: 11, color: "#1e293b" }}>Enter a patient name and click LOOKUP PATIENT</div>
              </div>
            )}

            {steps.map((step) => (
              <div key={step.id} style={{
                padding: step.type === "screenshot" ? 4 : "10px 14px",
                borderRadius: 8, border: "1px solid",
                animation: "fadeIn 0.3s ease",
                ...(step.type === "task" ? { background: "#1e293b", borderColor: "#334155", fontSize: 12, color: "#f1f5f9" }
                  : step.type === "thought" ? { background: "#0f172a", borderColor: "#1e293b", fontSize: 11, color: "#94a3b8", fontStyle: "italic" }
                  : step.type === "tool" ? { background: "#0f172a", borderColor: (TOOL_COLORS[step.tool] || "#3b82f6") + "44", fontSize: 11 }
                  : step.type === "screenshot" ? { background: "#0a0f1a", borderColor: "#f59e0b44" }
                  : step.type === "tool_result" ? { background: "#0a0f1a", borderColor: "#1e293b", fontSize: 11, color: "#64748b" }
                  : step.type === "error" ? { background: "#1a0a0a", borderColor: "#dc2626", fontSize: 11, color: "#f87171" }
                  : { background: "#0a1a0a", borderColor: "#10b981", fontSize: 11, color: "#34d399" })
              }}>
                {step.type === "task" && (
                  <div>
                    <div style={{ fontSize: 9, color: "#64748b", letterSpacing: "0.1em", marginBottom: 3 }}>TASK</div>
                    <div>{step.content}</div>
                  </div>
                )}
                {step.type === "thought" && (
                  <div>
                    <div style={{ fontSize: 9, color: "#64748b", letterSpacing: "0.1em", marginBottom: 3 }}>💭 THINKING</div>
                    <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{step.content}</div>
                  </div>
                )}
                {step.type === "tool" && (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <span>{TOOL_ICONS[step.tool] || "🔧"}</span>
                      <span style={{ color: TOOL_COLORS[step.tool] || "#3b82f6", fontWeight: 700, fontSize: 10, letterSpacing: "0.08em" }}>
                        {step.tool?.toUpperCase()}
                      </span>
                    </div>
                    <div style={{ background: "#070d1a", padding: "6px 8px", borderRadius: 4, fontSize: 10 }}>
                      {Object.entries(step.input).map(([k, v]) => (
                        <div key={k} style={{ marginBottom: 1 }}>
                          <span style={{ color: "#64748b" }}>{k}: </span>
                          <span style={{ color: "#e2e8f0" }}>{JSON.stringify(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {step.type === "screenshot" && (
                  <img src={step.image} alt="Browser screenshot"
                    style={{ width: "100%", borderRadius: 6, display: "block" }} />
                )}
                {step.type === "tool_result" && (
                  <div>
                    <div style={{ fontSize: 9, color: "#334155", letterSpacing: "0.1em", marginBottom: 3 }}>
                      {TOOL_ICONS[step.tool]} RESULT
                    </div>
                    <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, maxHeight: 200, overflow: "auto" }}>{step.result}</div>
                  </div>
                )}
                {(step.type === "done" || step.type === "stopped" || step.type === "error") && (
                  <div>
                    <div style={{ fontSize: 9, letterSpacing: "0.1em", marginBottom: 3, opacity: 0.7 }}>
                      {step.type === "done" ? "✅ COMPLETE" : step.type === "stopped" ? "⏹ STOPPED" : "❌ ERROR"}
                    </div>
                    <div>{step.content}</div>
                  </div>
                )}
              </div>
            ))}

            {running && (
              <div style={{
                padding: "10px 14px", borderRadius: 8,
                background: "#0f172a", border: "1px solid #10b98144",
                fontSize: 11, color: "#10b981", display: "flex", alignItems: "center", gap: 10
              }}>
                <div style={{
                  width: 14, height: 14, border: "2px solid #10b981",
                  borderTopColor: "transparent", borderRadius: "50%",
                  animation: "spin 0.8s linear infinite"
                }} />
                Agent working — this may take 1-2 minutes...
              </div>
            )}
            <div ref={stepsEndRef} />
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0a0a0f; }
        ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 2px; }
      `}</style>
    </div>
  );
}
