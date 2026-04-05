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
      description: "Type text slowly with human-like delays",
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
      description: "Wait for seconds",
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
      name: "press_key",
      description: "Press a keyboard key like Enter, Tab, Escape",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string" },
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
      description: "Mark task complete and return extracted notes",
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

const buildPatientPrompt = (patientName) => `You are a clinical workflow automation agent. The user has already logged into eClinicalWorks v12 manually. You are now operating inside an active eCW session.

Patient to look up: "${patientName}"

YOUR WORKFLOW:

STEP 1 — CHECK FOR DISCLAIMER:
- Take a screenshot
- If you see a disclaimer popup with "I AGREE" button, click it (selector: try "I AGREE" text, or button[class*="agree"], or the blue/green agree button)
- Wait 3 seconds and take another screenshot

STEP 2 — OPEN PATIENT LOOKUP:
- You should be on the eCW dashboard/schedule
- Look for a patient search. In eCW v12, press F2 or look for a search icon
- Try pressing F2 key first using press_key
- If a Patient Lookup modal appears, proceed to Step 3
- If no modal, try clicking the magnifying glass icon in the top bar
- Take a screenshot after each attempt

STEP 3 — SEARCH FOR PATIENT:
- In the Patient Lookup modal, find the "Primary Search" field (placeholder "Last Name, First Name")
- Type the patient name: "${patientName}"
- Use selector: input[placeholder*="Last Name"], or the first input in the modal
- Press Enter or click the Search button
- Wait 2 seconds
- Take a screenshot to see results

STEP 4 — SELECT PATIENT:
- Click on the correct patient row in the results table
- Wait 3 seconds for the chart to load
- Take a screenshot

STEP 5 — NAVIGATE TO PROGRESS NOTES:
- Look for a "Progress Note" tab or button in the patient chart
- Click it (selector: try text "Progress Note", or a[href*="progressnotes"], or the tab labeled Progress Note)
- Wait 2 seconds
- Take a screenshot

STEP 6 — EXTRACT THE NOTE:
- The progress note content should be visible in the main panel
- Extract text using these selectors in order:
  1. .progressNoteContent
  2. #progressNoteDiv
  3. div[class*="note"]
  4. div[class*="soap"]
  5. .leftPanel
  6. body (full page text as fallback)
- Scroll down and extract more if needed
- Call task_complete with all note text in the "notes" field

IMPORTANT:
- Take screenshots frequently to understand what you see
- If something fails, try an alternative approach
- The patient search in eCW opens as a modal popup
- Progress notes are in the left panel of the patient chart`;

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
  const [patientName, setPatientName] = useState("");
  const [loginStep, setLoginStep] = useState("idle"); // idle | navigating | waiting_for_login | agent_running
  const [liveViewUrl, setLiveViewUrl] = useState("");
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

  // Step 1: Navigate to eCW and get live view URL
  const startSession = async () => {
    setLoginStep("navigating");
    setSteps([]);
    setExtractedNotes("");
    sessionId.current = "session_" + Date.now();

    try {
      // Navigate to eCW login page
      const response = await fetch(`${backendUrl}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionId.current,
          tool: "navigate",
          input: { url: ecwUrl }
        })
      });
      const data = await response.json();

      // Get the live view URL from backend
      const liveRes = await fetch(`${backendUrl}/live-url?sessionId=${sessionId.current}`);
      const liveData = await liveRes.json();
      if (liveData.url) setLiveViewUrl(liveData.url);

      setLoginStep("waiting_for_login");
      addStep({ type: "info", content: "Browser opened. Please log in manually in the Live View window, then click 'I have logged in' below." });
    } catch (err) {
      addStep({ type: "error", content: `Failed to start session: ${err.message}` });
      setLoginStep("idle");
    }
  };

  // Step 2: User confirms they've logged in, agent takes over
  const continueAsAgent = async () => {
    if (!patientName.trim()) return;
    setLoginStep("agent_running");
    setRunning(true);
    setAgentStatus("thinking");
    abortRef.current = false;

    addStep({ type: "task", content: `Looking up patient: ${patientName}` });

    const messages = [
      { role: "system", content: buildPatientPrompt(patientName) },
      { role: "user", content: `I have logged in. Please find the progress notes for patient: ${patientName}` }
    ];

    let iterCount = 0;
    const MAX_ITER = 40;

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
          addStep({ type: "thought", content: message.content });
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

          addStep({ type: "tool", tool: toolName, input: toolInput });

          const result = await executeTool(toolName, toolInput);

          if (toolName === "screenshot" && typeof result === "string" && result.startsWith("data:image")) {
            addStep({ type: "screenshot", image: result });
            messages.push({ role: "tool", tool_call_id: toolCall.id, content: "Screenshot taken." });
            messages.push({
              role: "user",
              content: [
                { type: "text", text: "Current browser screenshot:" },
                { type: "image_url", image_url: { url: result, detail: "high" } }
              ]
            });
          } else {
            addStep({ type: "tool_result", tool: toolName, result: String(result) });
            messages.push({ role: "tool", tool_call_id: toolCall.id, content: String(result) });
          }

          if (toolName === "navigate") setCurrentUrl(toolInput.url);

          if (toolName === "task_complete") {
            if (toolInput.notes) setExtractedNotes(toolInput.notes);
            setAgentStatus("complete");
            setRunning(false);
            setLoginStep("idle");
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
    setLoginStep("idle");
    addStep({ type: "stopped", content: "Agent stopped." });
  };

  const resetSession = () => {
    setLoginStep("idle");
    setSteps([]);
    setExtractedNotes("");
    setCurrentUrl("");
    setAgentStatus("idle");
    setLiveViewUrl("");
    setRunning(false);
    abortRef.current = true;
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
              <div style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9" }}>eCW CLINICAL AGENT</div>
              <div style={{ fontSize: 11, color: "#64748b" }}>AUTHORIZED PERSONNEL ONLY</div>
            </div>
          </div>
          <div style={{
            padding: 16, background: "#1a0a0a", border: "1px solid #dc2626",
            borderRadius: 8, fontSize: 12, color: "#fca5a5", lineHeight: 1.9
          }}>
            <div style={{ fontWeight: 700, marginBottom: 8, color: "#ef4444", fontSize: 13 }}>
              ⚠️ AUTHORIZED USE ONLY
            </div>
            By proceeding, you confirm that:<br/>
            • You are a licensed medical professional or authorized staff<br/>
            • You have legitimate authorization to access these patient records<br/>
            • Your use complies with HIPAA and your organization's policies<br/>
            • Patient notes are displayed on screen only and not stored
          </div>
          <div style={{
            padding: 12, background: "#111827", border: "1px solid #1e293b",
            borderRadius: 8, fontSize: 11, color: "#64748b", lineHeight: 1.7
          }}>
            🔒 Credentials are used only for your eCW session and never stored.
          </div>
          <button
            onClick={() => setScreen("config")}
            style={{
              padding: 14, background: "linear-gradient(135deg, #dc2626, #991b1b)",
              border: "none", borderRadius: 8, color: "white",
              fontSize: 13, fontWeight: 700, cursor: "pointer"
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
    const ready = openaiKey.trim().startsWith("sk-") && backendUrl.trim() && ecwUrl.trim();
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
              <div style={{ fontSize: 10, color: "#64748b" }}>CONFIGURATION</div>
            </div>
          </div>

          {[
            { label: "OPENAI API KEY", val: openaiKey, set: setOpenaiKey, ph: "sk-...", type: "password" },
            { label: "BACKEND URL", val: backendUrl, set: setBackendUrl, ph: "https://your-app.onrender.com", type: "text" },
            { label: "eCW LOGIN URL", val: ecwUrl, set: setEcwUrl, ph: "https://nygemeapp.eclinicalweb.com/mobiledoc/jsp/webemr/login/newLogin.jsp", type: "text" },
          ].map(({ label, val, set, ph, type }) => (
            <div key={label}>
              <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.12em", marginBottom: 5 }}>{label}</div>
              <input type={type} value={val} onChange={e => set(e.target.value)} placeholder={ph} style={inputStyle} />
            </div>
          ))}

          <div style={{
            padding: 10, background: "#111827", border: "1px solid #1e293b",
            borderRadius: 8, fontSize: 11, color: "#64748b", lineHeight: 1.7
          }}>
            ℹ️ You will log in manually via a live browser view. No password is stored here.
          </div>

          <button
            onClick={() => setScreen("agent")}
            disabled={!ready}
            style={{
              marginTop: 4, padding: 12,
              background: ready ? "linear-gradient(135deg, #10b981, #3b82f6)" : "#1e293b",
              border: "none", borderRadius: 8, color: ready ? "white" : "#475569",
              fontSize: 13, fontWeight: 700, cursor: ready ? "pointer" : "not-allowed"
            }}
          >
            SAVE & CONTINUE →
          </button>
        </div>
        <style>{`* { box-sizing: border-box; }`}</style>
      </div>
    );
  }

  // MAIN AGENT SCREEN
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
          <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>eCW CLINICAL AGENT</div>
          <div style={{ fontSize: 10, color: "#64748b" }}>AUTHORIZED STAFF · GPT-4o · eClinicalWorks v12</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%",
            background: statusColors[agentStatus],
            boxShadow: `0 0 6px ${statusColors[agentStatus]}`,
            animation: running ? "pulse 1.5s infinite" : "none"
          }} />
          <span style={{ fontSize: 11, color: statusColors[agentStatus] }}>{statusLabels[agentStatus]}</span>
          <button
            onClick={() => setScreen("config")}
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
          width: 310, borderRight: "1px solid #1e293b", padding: 16,
          display: "flex", flexDirection: "column", gap: 12,
          background: "#0d0d14", overflowY: "auto"
        }}>

          {/* Step indicator */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { num: 1, label: "Open Browser", done: loginStep !== "idle" },
              { num: 2, label: "You Log In Manually", done: loginStep === "agent_running" || loginStep === "idle" && steps.length > 0 },
              { num: 3, label: "Agent Finds Patient Notes", done: agentStatus === "complete" },
            ].map(({ num, label, done }) => (
              <div key={num} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 10px", borderRadius: 6,
                background: done ? "#0a1a0a" : "#111827",
                border: `1px solid ${done ? "#166534" : "#1e293b"}`
              }}>
                <div style={{
                  width: 20, height: 20, borderRadius: "50%",
                  background: done ? "#10b981" : "#1e293b",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 700, color: done ? "white" : "#64748b", flexShrink: 0
                }}>{done ? "✓" : num}</div>
                <div style={{ fontSize: 11, color: done ? "#4ade80" : "#64748b" }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Step 1: Start Session */}
          {loginStep === "idle" && (
            <button
              onClick={startSession}
              style={{
                padding: "12px", background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
                border: "none", borderRadius: 8, color: "white",
                fontSize: 12, fontWeight: 700, cursor: "pointer"
              }}
            >
              1. OPEN eCW BROWSER →
            </button>
          )}

          {/* Step 2: Manual login prompt */}
          {loginStep === "waiting_for_login" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{
                padding: 12, background: "#1a1a0a", border: "1px solid #854d0e",
                borderRadius: 8, fontSize: 11, color: "#fbbf24", lineHeight: 1.7
              }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>👤 YOUR TURN</div>
                1. Click "Open Live Browser" below<br/>
                2. Log in with your eCW credentials<br/>
                3. Complete the Cloudflare checkbox<br/>
                4. Once you see the eCW dashboard, come back here and click Continue
              </div>

              {liveViewUrl && (
                <a
                  href={liveViewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "block", padding: "10px 12px", textAlign: "center",
                    background: "#1e3a5f", border: "1px solid #3b82f6",
                    borderRadius: 8, color: "#60a5fa", fontSize: 12,
                    textDecoration: "none", fontWeight: 700
                  }}
                >
                  🖥️ OPEN LIVE BROWSER
                </a>
              )}

              {!liveViewUrl && (
                <div style={{
                  padding: 10, background: "#111827", border: "1px solid #1e293b",
                  borderRadius: 8, fontSize: 11, color: "#64748b"
                }}>
                  ⚠️ Live view URL not available. Your Browserless plan may not support live view.
                  Log in via your regular browser session if possible.
                </div>
              )}

              <div>
                <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.12em", marginBottom: 5 }}>
                  PATIENT NAME
                </div>
                <input
                  type="text"
                  value={patientName}
                  onChange={e => setPatientName(e.target.value)}
                  placeholder="Last, First  or  First Last"
                  style={inputStyle}
                />
              </div>

              <button
                onClick={continueAsAgent}
                disabled={!patientName.trim()}
                style={{
                  padding: "12px", background: patientName.trim()
                    ? "linear-gradient(135deg, #10b981, #3b82f6)"
                    : "#1e293b",
                  border: "none", borderRadius: 8, color: patientName.trim() ? "white" : "#475569",
                  fontSize: 12, fontWeight: 700, cursor: patientName.trim() ? "pointer" : "not-allowed"
                }}
              >
                2. I'M LOGGED IN — FIND PATIENT →
              </button>

              <button
                onClick={resetSession}
                style={{
                  padding: "8px", background: "transparent",
                  border: "1px solid #334155", borderRadius: 8,
                  color: "#64748b", fontSize: 11, cursor: "pointer"
                }}
              >Cancel</button>
            </div>
          )}

          {/* Step 3: Agent running */}
          {loginStep === "agent_running" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{
                padding: 10, background: "#0f172a", border: "1px solid #3b82f644",
                borderRadius: 8, fontSize: 11, color: "#3b82f6"
              }}>
                🤖 Agent is searching for <strong style={{ color: "#e2e8f0" }}>{patientName}</strong>...
              </div>
              <button
                onClick={stopAgent}
                style={{
                  padding: "10px", background: "linear-gradient(135deg, #dc2626, #b91c1c)",
                  border: "none", borderRadius: 8, color: "white",
                  fontSize: 12, fontWeight: 700, cursor: "pointer"
                }}
              >⏹ STOP AGENT</button>
            </div>
          )}

          {/* Reset after complete */}
          {(agentStatus === "complete" || agentStatus === "stopped") && loginStep === "idle" && (
            <button
              onClick={resetSession}
              style={{
                padding: "10px", background: "linear-gradient(135deg, #10b981, #3b82f6)",
                border: "none", borderRadius: 8, color: "white",
                fontSize: 12, fontWeight: 700, cursor: "pointer"
              }}
            >+ NEW PATIENT LOOKUP</button>
          )}

          <div style={{
            padding: 10, background: "#0a1a0a", border: "1px solid #166534",
            borderRadius: 8, fontSize: 10, color: "#4ade80", lineHeight: 1.7, marginTop: "auto"
          }}>
            🔒 No credentials stored.<br/>
            Notes displayed on screen only.<br/>
            Session closed after each lookup.
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
                <span>📋 PROGRESS NOTES — {patientName.toUpperCase()}</span>
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
              }}>{extractedNotes}</pre>
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
                <div style={{ fontSize: 13, letterSpacing: "0.1em" }}>READY</div>
                <div style={{ fontSize: 11, color: "#1e293b", textAlign: "center" }}>
                  Click "Open eCW Browser", log in manually,<br/>then let the agent find the patient notes.
                </div>
              </div>
            )}

            {steps.map((step) => (
              <div key={step.id} style={{
                padding: step.type === "screenshot" ? 4 : "10px 14px",
                borderRadius: 8, border: "1px solid",
                animation: "fadeIn 0.3s ease",
                ...(step.type === "task" ? { background: "#1e293b", borderColor: "#334155", fontSize: 12, color: "#f1f5f9" }
                  : step.type === "info" ? { background: "#1a1a0a", borderColor: "#854d0e", fontSize: 11, color: "#fbbf24" }
                  : step.type === "thought" ? { background: "#0f172a", borderColor: "#1e293b", fontSize: 11, color: "#94a3b8", fontStyle: "italic" }
                  : step.type === "tool" ? { background: "#0f172a", borderColor: (TOOL_COLORS[step.tool] || "#3b82f6") + "44", fontSize: 11 }
                  : step.type === "screenshot" ? { background: "#0a0f1a", borderColor: "#f59e0b44" }
                  : step.type === "tool_result" ? { background: "#0a0f1a", borderColor: "#1e293b", fontSize: 11, color: "#64748b" }
                  : step.type === "error" ? { background: "#1a0a0a", borderColor: "#dc2626", fontSize: 11, color: "#f87171" }
                  : { background: "#0a1a0a", borderColor: "#10b981", fontSize: 11, color: "#34d399" })
              }}>
                {step.type === "task" && (<div><div style={{ fontSize: 9, color: "#64748b", marginBottom: 3 }}>TASK</div><div>{step.content}</div></div>)}
                {step.type === "info" && (<div><div style={{ fontSize: 9, color: "#854d0e", marginBottom: 3 }}>ℹ️ INFO</div><div>{step.content}</div></div>)}
                {step.type === "thought" && (<div><div style={{ fontSize: 9, color: "#64748b", marginBottom: 3 }}>💭 THINKING</div><div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{step.content}</div></div>)}
                {step.type === "tool" && (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <span>{TOOL_ICONS[step.tool] || "🔧"}</span>
                      <span style={{ color: TOOL_COLORS[step.tool] || "#3b82f6", fontWeight: 700, fontSize: 10 }}>{step.tool?.toUpperCase()}</span>
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
                  <img src={step.image} alt="Browser screenshot" style={{ width: "100%", borderRadius: 6, display: "block" }} />
                )}
                {step.type === "tool_result" && (
                  <div>
                    <div style={{ fontSize: 9, color: "#334155", marginBottom: 3 }}>{TOOL_ICONS[step.tool]} RESULT</div>
                    <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, maxHeight: 200, overflow: "auto" }}>{step.result}</div>
                  </div>
                )}
                {(step.type === "done" || step.type === "stopped" || step.type === "error") && (
                  <div>
                    <div style={{ fontSize: 9, marginBottom: 3, opacity: 0.7 }}>
                      {step.type === "done" ? "✅ COMPLETE" : step.type === "stopped" ? "⏹ STOPPED" : "❌ ERROR"}
                    </div>
                    <div>{step.content}</div>
                  </div>
                )}
              </div>
            ))}

            {running && (
              <div style={{
                padding: "10px 14px", borderRadius: 8, background: "#0f172a",
                border: "1px solid #10b98144", fontSize: 11, color: "#10b981",
                display: "flex", alignItems: "center", gap: 10
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
