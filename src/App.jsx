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
      name: "type",
      description: "Type text into an input field",
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
      name: "scroll",
      description: "Scroll the page",
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
      name: "extract",
      description: "Extract text content from a page element",
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
      name: "task_complete",
      description: "Mark task as complete and return extracted notes",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          notes: { type: "string", description: "The full extracted notes content" },
          success: { type: "boolean" }
        },
        required: ["summary", "success"]
      }
    }
  }
];

const buildSystemPrompt = (ecwUrl, username, password) => `You are a clinical workflow automation agent helping authorized medical staff retrieve patient notes from eClinicalWorks (eCW).

CREDENTIALS (use these to log in — never display them in your responses):
- eCW URL: ${ecwUrl}
- Username: ${username}
- Password: ${password}

WORKFLOW:
1. Navigate to the eCW URL
2. Take a screenshot to see the login page
3. Enter username into the username field
4. Enter password into the password field
5. Click the login/sign in button
6. Wait for the dashboard to load, take a screenshot
7. Find the patient search — usually a search bar at the top or a "Patients" menu
8. Search for the patient by name as instructed
9. Click on the correct patient from results
10. Wait for patient chart to load, take a screenshot
11. Navigate to Progress Notes and/or Encounter Notes
12. Extract the full text of the notes
13. Call task_complete with the extracted notes in the "notes" field

IMPORTANT:
- Never include credentials in your thinking text
- eCW login fields are often: input[name="username"], input[name="j_username"], #username, input[type="text"]
- Password fields: input[name="password"], input[name="j_password"], #password, input[type="password"]  
- If a page takes time to load, use the wait tool (2-3 seconds)
- If you hit a 2FA screen, take a screenshot and describe what you see
- Patient search in eCW is often in the top navigation bar
- Notes are usually under "Encounter" or "Progress Notes" tabs in the patient chart
- Extract the complete note text using the extract tool on the notes container
- Be thorough — scroll down to get all note content`;

const TOOL_ICONS = {
  navigate: "🌐", click: "👆", type: "⌨️", screenshot: "📷",
  scroll: "↕️", extract: "📋", wait: "⏳", task_complete: "✅"
};
const TOOL_COLORS = {
  navigate: "#3b82f6", click: "#8b5cf6", type: "#10b981", screenshot: "#f59e0b",
  scroll: "#6b7280", extract: "#ef4444", wait: "#6b7280", task_complete: "#10b981"
};

export default function MedicalAgent() {
  const [screen, setScreen] = useState("disclaimer"); // disclaimer | config | agent
  const [openaiKey, setOpenaiKey] = useState("");
  const [backendUrl, setBackendUrl] = useState("");
  const [ecwUrl, setEcwUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [task, setTask] = useState("");
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
    if (!task.trim() || running) return;
    abortRef.current = false;
    setRunning(true);
    setSteps([]);
    setExtractedNotes("");
    setCurrentUrl("");
    setAgentStatus("thinking");
    sessionId.current = "session_" + Date.now();

    const messages = [
      { role: "system", content: buildSystemPrompt(ecwUrl, username, password) },
      { role: "user", content: task }
    ];

    let iterCount = 0;
    const MAX_ITER = 30;

    addStep({ type: "task", content: task });

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
          // Redact any accidental credential leakage
          const safeContent = message.content
            .replace(new RegExp(password, 'g'), '***')
            .replace(new RegExp(username, 'g'), '***');
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

          // Don't show credentials in the UI
          const safeInput = { ...toolInput };
          if (safeInput.text && (safeInput.text === password || safeInput.text === username)) {
            safeInput.text = "***";
          }

          addStep({ type: "tool", tool: toolName, input: safeInput });

          const result = await executeTool(toolName, toolInput);

          if (toolName === "screenshot" && result.startsWith("data:image")) {
            addStep({ type: "screenshot", image: result });
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: "Screenshot taken."
            });
            messages.push({
              role: "user",
              content: [
                { type: "text", text: "Current browser screenshot:" },
                { type: "image_url", image_url: { url: result, detail: "high" } }
              ]
            });
          } else {
            const safeResult = typeof result === "string"
              ? result.replace(new RegExp(password, 'g'), '***')
              : result;
            addStep({ type: "tool_result", tool: toolName, result: safeResult });
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: result
            });
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

  // DISCLAIMER SCREEN
  if (screen === "disclaimer") {
    return (
      <div style={{
        fontFamily: "'JetBrains Mono', monospace", background: "#0a0a0f",
        minHeight: "100vh", color: "#e2e8f0", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 24
      }}>
        <div style={{
          maxWidth: 540, padding: 36, background: "#0d0d14",
          border: "1px solid #dc2626", borderRadius: 12,
          display: "flex", flexDirection: "column", gap: 20
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 32 }}>⚕️</div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", letterSpacing: "0.05em" }}>
                eCW CLINICAL AGENT
              </div>
              <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.1em" }}>
                AUTHORIZED PERSONNEL ONLY
              </div>
            </div>
          </div>

          <div style={{
            padding: 16, background: "#1a0a0a", border: "1px solid #dc2626",
            borderRadius: 8, fontSize: 12, color: "#fca5a5", lineHeight: 1.8
          }}>
            <div style={{ fontWeight: 700, marginBottom: 8, color: "#ef4444", fontSize: 13 }}>
              ⚠️ IMPORTANT — READ BEFORE CONTINUING
            </div>
            <div>By proceeding, you confirm that:</div>
            <div style={{ marginTop: 8, paddingLeft: 12 }}>
              • You are a licensed medical professional or authorized staff member<br/>
              • You have legitimate authorization to access the patient records you will retrieve<br/>
              • Your use of this tool complies with HIPAA and your organization's policies<br/>
              • Patient notes displayed will not be copied, stored, or shared inappropriately<br/>
              • You take full responsibility for appropriate use of patient data
            </div>
          </div>

          <div style={{
            padding: 12, background: "#111827", border: "1px solid #1e293b",
            borderRadius: 8, fontSize: 11, color: "#64748b", lineHeight: 1.7
          }}>
            <div style={{ color: "#94a3b8", marginBottom: 4 }}>🔒 PRIVACY</div>
            Your credentials are used only to log in and are never stored or transmitted anywhere
            other than directly to your eCW portal. Notes are displayed on screen only and not saved.
          </div>

          <button
            onClick={() => setScreen("config")}
            style={{
              padding: 14, background: "linear-gradient(135deg, #dc2626, #991b1b)",
              border: "none", borderRadius: 8, color: "white",
              fontSize: 13, fontWeight: 700, cursor: "pointer", letterSpacing: "0.08em"
            }}
          >
            I UNDERSTAND — CONTINUE AS AUTHORIZED STAFF →
          </button>
        </div>
        <style>{`* { box-sizing: border-box; }`}</style>
      </div>
    );
  }

  // CONFIG SCREEN
  if (screen === "config") {
    const ready = openaiKey.trim().startsWith("sk-") && backendUrl.trim() && ecwUrl.trim() && username.trim() && password.trim();
    return (
      <div style={{
        fontFamily: "'JetBrains Mono', monospace", background: "#0a0a0f",
        minHeight: "100vh", color: "#e2e8f0", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 24
      }}>
        <div style={{
          width: 480, padding: 32, background: "#0d0d14",
          border: "1px solid #1e293b", borderRadius: 12,
          display: "flex", flexDirection: "column", gap: 16
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
            <div style={{ fontSize: 28 }}>⚕️</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9" }}>eCW CLINICAL AGENT</div>
              <div style={{ fontSize: 11, color: "#64748b" }}>CONFIGURATION</div>
            </div>
          </div>

          {[
            { label: "OPENAI API KEY", value: openaiKey, set: setOpenaiKey, placeholder: "sk-...", type: "password" },
            { label: "BACKEND URL", value: backendUrl, set: setBackendUrl, placeholder: "https://your-app.onrender.com", type: "text" },
            { label: "eCW PORTAL URL", value: ecwUrl, set: setEcwUrl, placeholder: "https://yourpractice.eclinicalweb.com", type: "text" },
            { label: "eCW USERNAME", value: username, set: setUsername, placeholder: "your.username", type: "text" },
            { label: "eCW PASSWORD", value: password, set: setPassword, placeholder: "••••••••", type: "password" },
          ].map(({ label, value, set, placeholder, type }) => (
            <div key={label}>
              <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.12em", marginBottom: 6 }}>{label}</div>
              <input
                type={type}
                value={value}
                onChange={e => set(e.target.value)}
                placeholder={placeholder}
                style={inputStyle}
              />
            </div>
          ))}

          <button
            onClick={() => setScreen("agent")}
            disabled={!ready}
            style={{
              marginTop: 8, padding: 12,
              background: ready ? "linear-gradient(135deg, #10b981, #3b82f6)" : "#1e293b",
              border: "none", borderRadius: 8, color: ready ? "white" : "#475569",
              fontSize: 13, fontWeight: 700, cursor: ready ? "pointer" : "not-allowed",
              letterSpacing: "0.08em"
            }}
          >
            LAUNCH AGENT →
          </button>
        </div>
        <style>{`* { box-sizing: border-box; }`}</style>
      </div>
    );
  }

  // AGENT SCREEN
  const examples = [
    "Search for patient John Smith, find their most recent progress note, and display it",
    "Log in and retrieve the last 3 encounter notes for patient Jane Doe DOB 01/15/1980",
    "Find patient Robert Johnson and extract all notes from their last visit"
  ];

  return (
    <div style={{
      fontFamily: "'JetBrains Mono', monospace", background: "#0a0a0f",
      minHeight: "100vh", color: "#e2e8f0", display: "flex", flexDirection: "column"
    }}>
      {/* Header */}
      <div style={{
        borderBottom: "1px solid #1e293b", padding: "14px 24px",
        display: "flex", alignItems: "center", gap: 16, background: "#0d0d14"
      }}>
        <div style={{ fontSize: 24 }}>⚕️</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9", letterSpacing: "0.05em" }}>
            eCW CLINICAL AGENT
          </div>
          <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.1em" }}>
            AUTHORIZED STAFF ONLY · GPT-4o · REAL BROWSER
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: statusColors[agentStatus],
            boxShadow: `0 0 8px ${statusColors[agentStatus]}`,
            animation: running ? "pulse 1.5s infinite" : "none"
          }} />
          <span style={{ fontSize: 11, color: statusColors[agentStatus], letterSpacing: "0.08em" }}>
            {statusLabels[agentStatus]}
          </span>
          {currentUrl && (
            <div style={{
              marginLeft: 8, padding: "3px 10px", background: "#1e293b", borderRadius: 20,
              fontSize: 10, color: "#94a3b8", maxWidth: 260,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
            }}>
              🌐 {currentUrl}
            </div>
          )}
          <button
            onClick={() => { setScreen("config"); setSteps([]); setExtractedNotes(""); setAgentStatus("idle"); }}
            style={{
              marginLeft: 8, padding: "4px 10px", background: "#1e293b",
              border: "1px solid #334155", borderRadius: 6, color: "#64748b",
              fontSize: 11, cursor: "pointer"
            }}
          >
            ⚙️ Settings
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left Panel */}
        <div style={{
          width: 320, borderRight: "1px solid #1e293b", padding: 20,
          display: "flex", flexDirection: "column", gap: 14,
          background: "#0d0d14", overflowY: "auto"
        }}>
          <div>
            <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.12em", marginBottom: 6 }}>
              PATIENT LOOKUP TASK
            </div>
            <textarea
              value={task}
              onChange={e => setTask(e.target.value)}
              placeholder="e.g. Search for patient John Smith and retrieve their most recent progress note..."
              disabled={running}
              style={{
                ...inputStyle, minHeight: 110, resize: "vertical",
                lineHeight: 1.6, fontFamily: "inherit"
              }}
            />
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={running ? stopAgent : runAgent}
              disabled={!running && !task.trim()}
              style={{
                flex: 1, padding: "10px 16px",
                background: running
                  ? "linear-gradient(135deg, #dc2626, #b91c1c)"
                  : "linear-gradient(135deg, #10b981, #3b82f6)",
                border: "none", borderRadius: 8, color: "white",
                fontSize: 12, fontWeight: 700, cursor: "pointer",
                letterSpacing: "0.08em",
                opacity: (!running && !task.trim()) ? 0.4 : 1
              }}
            >
              {running ? "⏹ STOP" : "▶ RUN AGENT"}
            </button>
            {!running && steps.length > 0 && (
              <button
                onClick={() => { setSteps([]); setExtractedNotes(""); setCurrentUrl(""); setAgentStatus("idle"); }}
                style={{
                  padding: "10px 14px", background: "#1e293b",
                  border: "1px solid #334155", borderRadius: 8,
                  color: "#94a3b8", fontSize: 12, cursor: "pointer"
                }}
              >Clear</button>
            )}
          </div>

          <div>
            <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.12em", marginBottom: 6 }}>EXAMPLES</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {examples.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => setTask(ex)}
                  disabled={running}
                  style={{
                    padding: "7px 10px", background: "#111827",
                    border: "1px solid #1e293b", borderRadius: 6,
                    color: "#94a3b8", fontSize: 10, cursor: "pointer",
                    textAlign: "left", lineHeight: 1.5, transition: "border-color 0.2s"
                  }}
                  onMouseEnter={e => e.target.style.borderColor = "#10b981"}
                  onMouseLeave={e => e.target.style.borderColor = "#1e293b"}
                >{ex}</button>
              ))}
            </div>
          </div>

          <div style={{
            padding: 10, background: "#0a1a0a", border: "1px solid #166534",
            borderRadius: 8, fontSize: 10, color: "#4ade80", lineHeight: 1.7
          }}>
            🔒 Credentials are used only for this session and never stored.
            Notes are displayed on screen only.
          </div>
        </div>

        {/* Right Panel */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Extracted Notes Panel */}
          {extractedNotes && (
            <div style={{
              padding: 16, background: "#0a1a0a", borderBottom: "1px solid #166534",
              maxHeight: "35%", overflowY: "auto"
            }}>
              <div style={{ fontSize: 11, color: "#4ade80", letterSpacing: "0.1em", marginBottom: 8, fontWeight: 700 }}>
                📋 EXTRACTED NOTES
              </div>
              <pre style={{
                whiteSpace: "pre-wrap", fontSize: 12, color: "#e2e8f0",
                lineHeight: 1.7, margin: 0, fontFamily: "inherit"
              }}>
                {extractedNotes}
              </pre>
            </div>
          )}

          {/* Steps Feed */}
          <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            {steps.length === 0 && (
              <div style={{
                flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", color: "#334155", gap: 12
              }}>
                <div style={{ fontSize: 40 }}>⚕️</div>
                <div style={{ fontSize: 13, letterSpacing: "0.1em" }}>CLINICAL AGENT READY</div>
                <div style={{ fontSize: 11, color: "#1e293b" }}>Enter a patient lookup task and click RUN AGENT</div>
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
                      <span style={{ color: TOOL_COLORS[step.tool] || "#3b82f6", fontWeight: 700, letterSpacing: "0.08em", fontSize: 10 }}>
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
                    <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{step.result}</div>
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
                Agent working...
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
