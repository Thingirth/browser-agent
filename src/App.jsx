import { useState, useRef, useEffect, useCallback } from "react";

const TOOLS = [
  {
    type: "function",
    function: {
      name: "navigate",
      description: "Navigate the browser to a URL",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "Full URL to navigate to" } },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "click",
      description: "Click on an element. Use CSS selector or visible text as selector.",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector or visible text of element to click" },
          description: { type: "string", description: "What you are clicking" }
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
          selector: { type: "string", description: "CSS selector of the input field" },
          text: { type: "string", description: "Text to type" },
          description: { type: "string", description: "Description of the field" }
        },
        required: ["selector", "text", "description"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "screenshot",
      description: "Take a screenshot to see the current state of the browser",
      parameters: {
        type: "object",
        properties: {
          description: { type: "string", description: "Why you are taking this screenshot" }
        },
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
          amount: { type: "number", description: "Pixels to scroll" }
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
          selector: { type: "string", description: "CSS selector or 'body' for full page" },
          description: { type: "string", description: "What you are extracting" }
        },
        required: ["selector", "description"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "wait",
      description: "Wait for a number of seconds",
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
      description: "Mark the task as complete",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          success: { type: "boolean" }
        },
        required: ["summary", "success"]
      }
    }
  }
];

const SYSTEM_PROMPT = `You are an expert browser automation agent controlling a real web browser.

You have access to these tools:
- navigate: Go to a URL
- screenshot: See the current page (returns a real screenshot image)
- click: Click elements using CSS selectors or visible text
- type: Fill in input fields
- scroll: Scroll the page
- extract: Read text from the page
- wait: Pause execution
- task_complete: Signal task is done

IMPORTANT GUIDELINES:
1. Always start by navigating to the target website
2. Take a screenshot after every navigation to see the real page state
3. Use the screenshot content to decide your next action
4. NEVER give up after one failed attempt - always try multiple approaches
5. For Macy's search bar, try these selectors in order:
   - input[placeholder*="looking"]
   - input[placeholder*="search" i]
   - input[type="search"]
   - #globalSearchInput
6. If typing into a search box fails, navigate directly to search results URL instead.
   Example: navigate to https://www.macys.com/shop/featured/mens+dress+shirt
7. For e-commerce: navigate → screenshot → search → screenshot → click product → screenshot → add to cart → checkout
8. When you see a login wall, describe it and stop
9. Always take a screenshot after each action to confirm it worked
10. If a click or type fails, study the screenshot carefully and try a different selector
11. Prefer direct navigation URLs over UI interaction when UI interaction keeps failing`;

const TOOL_ICONS = {
  navigate: "🌐", click: "👆", type: "⌨️", screenshot: "📷",
  scroll: "↕️", extract: "📋", wait: "⏳", task_complete: "✅"
};
const TOOL_COLORS = {
  navigate: "#3b82f6", click: "#8b5cf6", type: "#10b981", screenshot: "#f59e0b",
  scroll: "#6b7280", extract: "#ef4444", wait: "#6b7280", task_complete: "#10b981"
};

export default function BrowserAgent() {
  const [openaiKey, setOpenaiKey] = useState("");
  const [backendUrl, setBackendUrl] = useState("");
  const [configured, setConfigured] = useState(false);
  const [task, setTask] = useState("");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState([]);
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

  // Call the real backend
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
    setCurrentUrl("");
    setAgentStatus("thinking");
    sessionId.current = "session_" + Date.now();

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: task }
    ];

    let iterCount = 0;
    const MAX_ITER = 25;

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
            max_tokens: 1000,
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

          // Execute on real browser via backend
          const result = await executeTool(toolName, toolInput);

          // If screenshot, show the image
          if (toolName === "screenshot" && result.startsWith("data:image")) {
            addStep({ type: "screenshot", image: result });
            // OpenAI only allows image_url in user messages, not tool messages
            // Send tool result as text, then send image as a follow-up user message
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: "Screenshot taken successfully. See the attached image in the next message."
            });
            messages.push({
              role: "user",
              content: [
                { type: "text", text: "Here is the current screenshot of the browser:" },
                { type: "image_url", image_url: { url: result, detail: "low" } }
              ]
            });
          } else {
            addStep({ type: "tool_result", tool: toolName, result });
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: result
            });
          }

          // Update URL display if navigate
          if (toolName === "navigate") {
            setCurrentUrl(toolInput.url);
          }

          if (toolName === "task_complete") {
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

  const examples = [
    "Go to Macys.com, search for a men's dress shirt, select the first result, choose size M, and add it to the cart",
    "Navigate to Amazon.com and find a bestselling Bluetooth speaker under $50",
    "Go to google.com and search for the latest AI news"
  ];

  const statusColors = {
    idle: "#6b7280", thinking: "#3b82f6", acting: "#8b5cf6",
    complete: "#10b981", stopped: "#f59e0b", error: "#ef4444"
  };
  const statusLabels = {
    idle: "Idle", thinking: "Thinking...", acting: "Acting...",
    complete: "Complete", stopped: "Stopped", error: "Error"
  };

  // Config screen
  if (!configured) {
    return (
      <div style={{
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        background: "#0a0a0f", minHeight: "100vh", color: "#e2e8f0",
        display: "flex", alignItems: "center", justifyContent: "center"
      }}>
        <div style={{
          width: 440, padding: 32, background: "#0d0d14",
          border: "1px solid #1e293b", borderRadius: 12,
          display: "flex", flexDirection: "column", gap: 20
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: "linear-gradient(135deg, #10b981, #3b82f6)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20
            }}>🤖</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9", letterSpacing: "0.05em" }}>BROWSER AGENT</div>
              <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.1em" }}>REAL BROWSER · GPT-4o</div>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.12em", marginBottom: 8 }}>OPENAI API KEY</div>
            <input
              type="password"
              value={openaiKey}
              onChange={e => setOpenaiKey(e.target.value)}
              placeholder="sk-..."
              style={{
                width: "100%", padding: "10px 12px", background: "#111827",
                border: "1px solid #1e293b", borderRadius: 8, color: "#e2e8f0",
                fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box"
              }}
            />
          </div>

          <div>
            <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.12em", marginBottom: 8 }}>BACKEND URL</div>
            <input
              type="text"
              value={backendUrl}
              onChange={e => setBackendUrl(e.target.value)}
              placeholder="https://your-app.onrender.com"
              style={{
                width: "100%", padding: "10px 12px", background: "#111827",
                border: "1px solid #1e293b", borderRadius: 8, color: "#e2e8f0",
                fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box"
              }}
            />
            <div style={{ fontSize: 10, color: "#334155", marginTop: 6 }}>
              The URL of your Render backend (e.g. https://browser-agent-backend.onrender.com)
            </div>
          </div>

          <button
            onClick={() => setConfigured(true)}
            disabled={!openaiKey.trim().startsWith("sk-") || !backendUrl.trim()}
            style={{
              padding: 12, background: "linear-gradient(135deg, #10b981, #3b82f6)",
              border: "none", borderRadius: 8, color: "white",
              fontSize: 13, fontWeight: 700, cursor: "pointer", letterSpacing: "0.08em",
              opacity: (!openaiKey.trim().startsWith("sk-") || !backendUrl.trim()) ? 0.4 : 1
            }}
          >
            LAUNCH AGENT →
          </button>
        </div>
        <style>{`* { box-sizing: border-box; }`}</style>
      </div>
    );
  }

  return (
    <div style={{
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      background: "#0a0a0f", minHeight: "100vh", color: "#e2e8f0",
      display: "flex", flexDirection: "column"
    }}>
      {/* Header */}
      <div style={{
        borderBottom: "1px solid #1e293b", padding: "16px 24px",
        display: "flex", alignItems: "center", gap: 16, background: "#0d0d14"
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: "linear-gradient(135deg, #10b981, #3b82f6)",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18
        }}>🤖</div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.05em", color: "#f1f5f9" }}>BROWSER AGENT</div>
          <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.1em" }}>REAL BROWSER · GPT-4o · STEEL.DEV</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: statusColors[agentStatus],
            boxShadow: `0 0 8px ${statusColors[agentStatus]}`,
            animation: running ? "pulse 1.5s infinite" : "none"
          }} />
          <span style={{ fontSize: 12, color: statusColors[agentStatus], letterSpacing: "0.08em" }}>
            {statusLabels[agentStatus]}
          </span>
          {currentUrl && (
            <div style={{
              marginLeft: 16, padding: "4px 12px", background: "#1e293b", borderRadius: 20,
              fontSize: 11, color: "#94a3b8", maxWidth: 300,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
            }}>
              🌐 {currentUrl}
            </div>
          )}
          <button
            onClick={() => { setConfigured(false); setSteps([]); setCurrentUrl(""); setAgentStatus("idle"); }}
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
          width: 340, borderRight: "1px solid #1e293b", padding: 20,
          display: "flex", flexDirection: "column", gap: 16,
          background: "#0d0d14", overflowY: "auto"
        }}>
          <div>
            <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.12em", marginBottom: 8 }}>TASK</div>
            <textarea
              value={task}
              onChange={e => setTask(e.target.value)}
              placeholder="Describe what you want the agent to do..."
              disabled={running}
              style={{
                width: "100%", minHeight: 120, padding: 12,
                background: "#111827", border: "1px solid #1e293b",
                borderRadius: 8, color: "#e2e8f0", fontSize: 13,
                fontFamily: "inherit", resize: "vertical", outline: "none",
                lineHeight: 1.6, boxSizing: "border-box"
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
                fontSize: 13, fontWeight: 700, cursor: "pointer",
                letterSpacing: "0.08em",
                opacity: (!running && !task.trim()) ? 0.4 : 1
              }}
            >
              {running ? "⏹ STOP" : "▶ RUN AGENT"}
            </button>
            {!running && steps.length > 0 && (
              <button
                onClick={() => { setSteps([]); setCurrentUrl(""); setAgentStatus("idle"); }}
                style={{
                  padding: "10px 16px", background: "#1e293b",
                  border: "1px solid #334155", borderRadius: 8,
                  color: "#94a3b8", fontSize: 13, cursor: "pointer"
                }}
              >Clear</button>
            )}
          </div>

          <div>
            <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.12em", marginBottom: 8 }}>EXAMPLES</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {examples.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => setTask(ex)}
                  disabled={running}
                  style={{
                    padding: "8px 12px", background: "#111827",
                    border: "1px solid #1e293b", borderRadius: 6,
                    color: "#94a3b8", fontSize: 11, cursor: "pointer",
                    textAlign: "left", lineHeight: 1.5, transition: "border-color 0.2s"
                  }}
                  onMouseEnter={e => e.target.style.borderColor = "#10b981"}
                  onMouseLeave={e => e.target.style.borderColor = "#1e293b"}
                >{ex}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Panel */}
        <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          {steps.length === 0 && (
            <div style={{
              flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", color: "#334155", gap: 16
            }}>
              <div style={{ fontSize: 48 }}>🤖</div>
              <div style={{ fontSize: 14, letterSpacing: "0.1em" }}>REAL BROWSER AGENT READY</div>
              <div style={{ fontSize: 12, color: "#1e293b" }}>Enter a task and click RUN AGENT</div>
            </div>
          )}

          {steps.map((step) => (
            <div key={step.id} style={{
              padding: step.type === "screenshot" ? 4 : "12px 16px",
              borderRadius: 8, border: "1px solid",
              animation: "fadeIn 0.3s ease",
              ...(step.type === "task" ? { background: "#1e293b", borderColor: "#334155", fontSize: 13, color: "#f1f5f9" }
                : step.type === "thought" ? { background: "#0f172a", borderColor: "#1e293b", fontSize: 12, color: "#94a3b8", fontStyle: "italic" }
                : step.type === "tool" ? { background: "#0f172a", borderColor: (TOOL_COLORS[step.tool] || "#3b82f6") + "44", fontSize: 12 }
                : step.type === "screenshot" ? { background: "#0a0f1a", borderColor: "#f59e0b44" }
                : step.type === "tool_result" ? { background: "#0a0f1a", borderColor: "#1e293b", fontSize: 12, color: "#64748b" }
                : step.type === "error" ? { background: "#1a0a0a", borderColor: "#dc2626", fontSize: 12, color: "#f87171" }
                : { background: "#0a1a0a", borderColor: "#10b981", fontSize: 12, color: "#34d399" })
            }}>
              {step.type === "task" && (
                <div>
                  <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.1em", marginBottom: 4 }}>TASK</div>
                  <div>{step.content}</div>
                </div>
              )}
              {step.type === "thought" && (
                <div>
                  <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.1em", marginBottom: 4 }}>💭 THINKING</div>
                  <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{step.content}</div>
                </div>
              )}
              {step.type === "tool" && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 16 }}>{TOOL_ICONS[step.tool] || "🔧"}</span>
                    <span style={{ color: TOOL_COLORS[step.tool] || "#3b82f6", fontWeight: 700, letterSpacing: "0.08em", fontSize: 11 }}>
                      {step.tool?.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ background: "#070d1a", padding: "8px 10px", borderRadius: 4, fontSize: 11 }}>
                    {Object.entries(step.input).map(([k, v]) => (
                      <div key={k} style={{ marginBottom: 2 }}>
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
                  <div style={{ fontSize: 10, color: "#334155", letterSpacing: "0.1em", marginBottom: 4 }}>
                    {TOOL_ICONS[step.tool]} RESULT
                  </div>
                  <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{step.result}</div>
                </div>
              )}
              {(step.type === "done" || step.type === "stopped" || step.type === "error") && (
                <div>
                  <div style={{ fontSize: 10, letterSpacing: "0.1em", marginBottom: 4, opacity: 0.7 }}>
                    {step.type === "done" ? "✅ COMPLETE" : step.type === "stopped" ? "⏹ STOPPED" : "❌ ERROR"}
                  </div>
                  <div>{step.content}</div>
                </div>
              )}
            </div>
          ))}

          {running && (
            <div style={{
              padding: "12px 16px", borderRadius: 8,
              background: "#0f172a", border: "1px solid #10b98144",
              fontSize: 12, color: "#10b981", display: "flex", alignItems: "center", gap: 10
            }}>
              <div style={{
                width: 16, height: 16, border: "2px solid #10b981",
                borderTopColor: "transparent", borderRadius: "50%",
                animation: "spin 0.8s linear infinite"
              }} />
              Agent working...
            </div>
          )}
          <div ref={stepsEndRef} />
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
