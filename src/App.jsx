import { useState, useRef, useEffect, useCallback } from "react";

// OpenAI tool format: { type: "function", function: { name, description, parameters } }
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
      description: "Click on an element described by a CSS selector or text content",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector or descriptive label of element to click" },
          description: { type: "string", description: "Human-readable description of what is being clicked" }
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
          description: { type: "string", description: "Human-readable description of the action" }
        },
        required: ["selector", "text", "description"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "screenshot",
      description: "Take a screenshot of the current browser state to see what's on the page",
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
      description: "Scroll the page to find more content",
      parameters: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["up", "down"], description: "Direction to scroll" },
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
      description: "Extract and read text content from the current page",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector of element to extract from, or 'body' for all" },
          description: { type: "string", description: "What you are trying to extract" }
        },
        required: ["selector", "description"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "wait",
      description: "Wait for a page element to load or a short delay",
      parameters: {
        type: "object",
        properties: {
          seconds: { type: "number", description: "Seconds to wait" },
          description: { type: "string", description: "What you are waiting for" }
        },
        required: ["seconds", "description"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "task_complete",
      description: "Mark the task as complete with a summary of what was accomplished",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Summary of what was accomplished" },
          success: { type: "boolean", description: "Whether the task was completed successfully" }
        },
        required: ["summary", "success"]
      }
    }
  }
];

const SYSTEM_PROMPT = `You are an expert browser automation agent. You control a web browser to complete tasks on behalf of the user.

You have access to these tools:
- navigate: Go to a URL
- click: Click elements on the page
- type: Enter text in fields
- screenshot: View the current page state
- scroll: Scroll through pages
- extract: Read text from page elements
- wait: Wait for page loads
- task_complete: Signal task completion

IMPORTANT GUIDELINES:
1. Always start by navigating to the target website
2. Take screenshots frequently to understand current page state
3. Be thorough - search for specific products, add to cart, proceed to checkout
4. If you encounter login walls, note them and explain what would happen next
5. For e-commerce tasks: navigate → search → select product → add to cart → checkout
6. Narrate your thinking clearly between tool calls
7. Be realistic about what you can and cannot do (e.g., you cannot complete real payments)
8. When you reach checkout and need payment info, describe what fields you see and what would happen next

You are simulating a real browser session. Describe what you "see" realistically based on how these sites actually work.`;

// Simulated browser execution layer
function simulateBrowserAction(action, input, currentUrl) {
  const domain = currentUrl
    ? (() => { try { return new URL(currentUrl.startsWith('http') ? currentUrl : 'https://' + currentUrl).hostname; } catch { return ''; } })()
    : '';

  if (action === "navigate") {
    const url = input.url.startsWith('http') ? input.url : 'https://' + input.url;
    return { newUrl: url, result: `Navigated to ${url}. Page loaded successfully.` };
  }

  if (action === "screenshot") {
    if (domain.includes('macys')) {
      if (currentUrl.includes('/p/') || currentUrl.includes('/product')) {
        return { result: `[Screenshot] Product Detail Page on Macys.com\n• Product title, price, and main image visible\n• Size/color selectors present\n• "ADD TO BAG" button visible (prominent red button)\n• Product description, ratings below\n• Recommended items at bottom` };
      }
      if (currentUrl.includes('search') || currentUrl.includes('q=')) {
        return { result: `[Screenshot] Search Results on Macys.com\n• Search bar at top with current query\n• Filter panel on left (Brand, Size, Color, Price range)\n• Grid of product cards (24 items shown)\n• Each card has product image, name, price, ratings` };
      }
      if (currentUrl.includes('cart') || currentUrl.includes('bag')) {
        return { result: `[Screenshot] Shopping Bag on Macys.com\n• Item added to bag visible with image, name, size, color\n• Quantity selector\n• "CHECKOUT" button (large, prominent)\n• Order summary: Subtotal, Estimated shipping, Estimated total` };
      }
      if (currentUrl.includes('checkout')) {
        return { result: `[Screenshot] Checkout Page on Macys.com\n• Step 1 of 3: Sign In / Guest Checkout options\n• Email field for guest checkout\n• "CONTINUE AS GUEST" button visible\n• Security badges shown` };
      }
      return { result: `[Screenshot] Macys.com Homepage\n• Top navigation: Women, Men, Kids, Home, Beauty, Sale\n• Search bar prominently displayed\n• Hero banner with current promotions\n• Sign In / Create Account in header` };
    }
    if (domain.includes('amazon')) {
      return { result: `[Screenshot] Amazon.com page loaded\n• Search bar at top\n• Navigation categories visible\n• Page content based on current URL` };
    }
    return { result: `[Screenshot] Browser showing: ${currentUrl}\n• Page has loaded successfully\n• Standard web page layout visible` };
  }

  if (action === "click") {
    const desc = (input.description || '').toLowerCase();
    if (desc.includes('add to bag') || desc.includes('add to cart')) {
      return { result: `Clicked "${input.description}". Item added to shopping bag. Bag icon in header now shows (1).` };
    }
    if (desc.includes('checkout') || desc.includes('proceed')) {
      return { result: `Clicked "${input.description}". Redirecting to checkout...`, newUrl: domain.includes('macys') ? 'https://www.macys.com/checkout/' : currentUrl };
    }
    if (desc.includes('search') || desc.includes('submit')) {
      return { result: `Clicked "${input.description}". Search submitted.` };
    }
    if (desc.includes('size') || desc.includes('color')) {
      return { result: `Clicked "${input.description}". Selection applied. Option highlighted.` };
    }
    if (desc.includes('product') || desc.includes('item')) {
      return { result: `Clicked "${input.description}". Navigating to product detail page...`, newUrl: domain.includes('macys') ? 'https://www.macys.com/shop/product/detail' : currentUrl };
    }
    return { result: `Clicked "${input.description}". Action performed successfully.` };
  }

  if (action === "type") {
    return { result: `Typed "${input.text}" into ${input.description}. Text entered successfully.` };
  }
  if (action === "scroll") {
    return { result: `Scrolled ${input.direction} by ${input.amount}px. More content now visible.` };
  }
  if (action === "extract") {
    if (domain.includes('macys') && (input.description || '').toLowerCase().includes('product')) {
      return { result: `Extracted product info:\n• Name: Calvin Klein Men's Extra Slim Fit Dress Shirt\n• Price: $49.99 (Orig. $89.50)\n• Rating: 4.3/5 (127 reviews)\n• Available sizes: S, M, L, XL, XXL\n• Colors: White, Light Blue, Charcoal\n• In Stock: Yes` };
    }
    return { result: `Extracted text from "${input.selector}": [Page content retrieved successfully]` };
  }
  if (action === "wait") {
    return { result: `Waited ${input.seconds}s for: ${input.description}. Ready to continue.` };
  }
  if (action === "task_complete") {
    return { result: input.summary, isComplete: true, success: input.success };
  }
  return { result: "Action performed." };
}

const TOOL_ICONS = {
  navigate: "🌐", click: "👆", type: "⌨️", screenshot: "📷",
  scroll: "↕️", extract: "📋", wait: "⏳", task_complete: "✅"
};
const TOOL_COLORS = {
  navigate: "#3b82f6", click: "#8b5cf6", type: "#10b981", screenshot: "#f59e0b",
  scroll: "#6b7280", extract: "#ef4444", wait: "#6b7280", task_complete: "#10b981"
};

export default function BrowserAgentOpenAI() {
  const [apiKey, setApiKey] = useState("");
  const [apiKeySet, setApiKeySet] = useState(false);
  const [task, setTask] = useState("");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState([]);
  const [currentUrl, setCurrentUrl] = useState("");
  const [agentStatus, setAgentStatus] = useState("idle");
  const stepsEndRef = useRef(null);
  const abortRef = useRef(false);

  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps]);

  const addStep = useCallback((step) => {
    setSteps(prev => [...prev, { ...step, id: Date.now() + Math.random() }]);
  }, []);

  const runAgent = async () => {
    if (!task.trim() || running || !apiKey.trim()) return;
    abortRef.current = false;
    setRunning(true);
    setSteps([]);
    setCurrentUrl("");
    setAgentStatus("thinking");

    // OpenAI message format
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: task }
    ];

    let urlState = "";
    let iterCount = 0;
    const MAX_ITER = 20;

    addStep({ type: "task", content: task });

    try {
      while (iterCount < MAX_ITER && !abortRef.current) {
        iterCount++;
        setAgentStatus("thinking");

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey.trim()}`
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
        const finishReason = data.choices[0].finish_reason;

        // Add assistant message to history
        messages.push(message);

        // Show any text content
        if (message.content && message.content.trim()) {
          addStep({ type: "thought", content: message.content });
        }

        // No tool calls → done
        if (!message.tool_calls || message.tool_calls.length === 0) {
          addStep({ type: "done", content: message.content || "Agent finished." });
          break;
        }

        // Execute each tool call
        setAgentStatus("acting");
        for (const toolCall of message.tool_calls) {
          if (abortRef.current) break;

          const toolName = toolCall.function.name;
          let toolInput = {};
          try { toolInput = JSON.parse(toolCall.function.arguments); } catch {}

          addStep({ type: "tool", tool: toolName, input: toolInput, status: "running" });

          await new Promise(r => setTimeout(r, 600 + Math.random() * 400));

          const simResult = simulateBrowserAction(toolName, toolInput, urlState);
          if (simResult.newUrl) {
            urlState = simResult.newUrl;
            setCurrentUrl(simResult.newUrl);
          }

          addStep({ type: "tool_result", tool: toolName, result: simResult.result, isComplete: simResult.isComplete });

          // OpenAI requires tool results as role:"tool" with tool_call_id
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: simResult.result
          });

          if (simResult.isComplete) {
            setAgentStatus("complete");
            setRunning(false);
            return;
          }
        }

        if (finishReason === "stop") break;
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
    addStep({ type: "stopped", content: "Agent stopped by user." });
  };

  const examples = [
    "Go to Macys.com, search for a men's dress shirt, select the first result, choose size M, and add it to the cart",
    "Navigate to Amazon.com and find a bestselling Bluetooth speaker under $50",
    "Go to Macys.com and find women's running shoes on sale, then add to bag and proceed to checkout"
  ];

  const statusColors = {
    idle: "#6b7280", thinking: "#3b82f6", acting: "#8b5cf6",
    complete: "#10b981", stopped: "#f59e0b", error: "#ef4444"
  };
  const statusLabels = {
    idle: "Idle", thinking: "Thinking...", acting: "Acting...",
    complete: "Complete", stopped: "Stopped", error: "Error"
  };

  if (!apiKeySet) {
    return (
      <div style={{
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        background: "#0a0a0f", minHeight: "100vh", color: "#e2e8f0",
        display: "flex", alignItems: "center", justifyContent: "center"
      }}>
        <div style={{
          width: 420, padding: 32,
          background: "#0d0d14", border: "1px solid #1e293b", borderRadius: 12,
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
              <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.1em" }}>POWERED BY GPT-4o</div>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.12em", marginBottom: 8 }}>
              OPENAI API KEY
            </div>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-..."
              onKeyDown={e => { if (e.key === "Enter" && apiKey.trim().startsWith("sk-")) setApiKeySet(true); }}
              style={{
                width: "100%", padding: "10px 12px",
                background: "#111827", border: "1px solid #1e293b",
                borderRadius: 8, color: "#e2e8f0", fontSize: 13,
                fontFamily: "inherit", outline: "none", boxSizing: "border-box"
              }}
            />
            <div style={{ fontSize: 10, color: "#334155", marginTop: 6 }}>
              Your key is never stored. It's used only in-browser for API calls.
            </div>
          </div>

          <button
            onClick={() => setApiKeySet(true)}
            disabled={!apiKey.trim().startsWith("sk-")}
            style={{
              padding: "12px", background: "linear-gradient(135deg, #10b981, #3b82f6)",
              border: "none", borderRadius: 8, color: "white",
              fontSize: 13, fontWeight: 700, cursor: "pointer",
              letterSpacing: "0.08em",
              opacity: !apiKey.trim().startsWith("sk-") ? 0.4 : 1
            }}
          >
            CONNECT →
          </button>

          <div style={{
            padding: 12, background: "#111827", border: "1px solid #1e293b",
            borderRadius: 8, fontSize: 11, color: "#64748b", lineHeight: 1.7
          }}>
            <div style={{ color: "#fbbf24", marginBottom: 4, fontWeight: 700 }}>ℹ️ REQUIREMENTS</div>
            You need an OpenAI API key with access to <span style={{ color: "#e2e8f0" }}>gpt-4o</span>.
            Get one at <span style={{ color: "#3b82f6" }}>platform.openai.com</span>
          </div>
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
        display: "flex", alignItems: "center", gap: "16px", background: "#0d0d14"
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: "linear-gradient(135deg, #10b981, #3b82f6)",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18
        }}>🤖</div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.05em", color: "#f1f5f9" }}>
            BROWSER AGENT
          </div>
          <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.1em" }}>
            POWERED BY GPT-4o · AUTONOMOUS WEB NAVIGATION
          </div>
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
              marginLeft: 16, padding: "4px 12px",
              background: "#1e293b", borderRadius: 20,
              fontSize: 11, color: "#94a3b8",
              maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
            }}>
              🌐 {currentUrl}
            </div>
          )}
          <button
            onClick={() => { setApiKeySet(false); setApiKey(""); setSteps([]); setCurrentUrl(""); setAgentStatus("idle"); }}
            style={{
              marginLeft: 8, padding: "4px 10px", background: "#1e293b",
              border: "1px solid #334155", borderRadius: 6, color: "#64748b",
              fontSize: 11, cursor: "pointer"
            }}
          >
            🔑 Change Key
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left Panel */}
        <div style={{
          width: 340, borderRight: "1px solid #1e293b",
          padding: 20, display: "flex", flexDirection: "column", gap: 16,
          background: "#0d0d14", overflowY: "auto"
        }}>
          <div>
            <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.12em", marginBottom: 8 }}>TASK INSTRUCTION</div>
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
              onKeyDown={e => { if (e.key === "Enter" && e.metaKey) runAgent(); }}
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
                letterSpacing: "0.08em", opacity: (!running && !task.trim()) ? 0.4 : 1
              }}
            >
              {running ? "⏹ STOP AGENT" : "▶ RUN AGENT"}
            </button>
            {!running && steps.length > 0 && (
              <button
                onClick={() => { setSteps([]); setCurrentUrl(""); setAgentStatus("idle"); }}
                style={{
                  padding: "10px 16px", background: "#1e293b",
                  border: "1px solid #334155", borderRadius: 8, color: "#94a3b8",
                  fontSize: 13, cursor: "pointer"
                }}
              >
                Clear
              </button>
            )}
          </div>

          <div>
            <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.12em", marginBottom: 8 }}>EXAMPLE TASKS</div>
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
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>

          <div style={{
            padding: 12, background: "#111827", border: "1px solid #1e293b",
            borderRadius: 8, fontSize: 11, color: "#64748b", lineHeight: 1.7
          }}>
            <div style={{ color: "#fbbf24", marginBottom: 4, fontWeight: 700 }}>⚠ SIMULATION NOTE</div>
            This agent simulates browser actions. Real automation needs a Playwright/Puppeteer backend. GPT-4o plans real steps — only execution is simulated.
          </div>
        </div>

        {/* Right Panel - Steps */}
        <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          {steps.length === 0 && (
            <div style={{
              flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              color: "#334155", gap: 16
            }}>
              <div style={{ fontSize: 48 }}>🤖</div>
              <div style={{ fontSize: 14, letterSpacing: "0.1em" }}>AGENT READY</div>
              <div style={{ fontSize: 12, color: "#1e293b" }}>Enter a task and click RUN AGENT</div>
            </div>
          )}

          {steps.map((step) => (
            <div key={step.id} style={{
              padding: "12px 16px", borderRadius: 8, border: "1px solid",
              animation: "fadeIn 0.3s ease",
              ...(step.type === "task" ? {
                background: "#1e293b", borderColor: "#334155", fontSize: 13, color: "#f1f5f9"
              } : step.type === "thought" ? {
                background: "#0f172a", borderColor: "#1e293b", fontSize: 12, color: "#94a3b8", fontStyle: "italic"
              } : step.type === "tool" ? {
                background: "#0f172a", borderColor: (TOOL_COLORS[step.tool] || "#3b82f6") + "44", fontSize: 12
              } : step.type === "tool_result" ? {
                background: "#0a0f1a", borderColor: "#1e293b", fontSize: 12, color: "#64748b"
              } : step.type === "error" ? {
                background: "#1a0a0a", borderColor: "#dc2626", fontSize: 12, color: "#f87171"
              } : step.type === "done" || step.type === "stopped" ? {
                background: "#0a1a0a", borderColor: "#10b981", fontSize: 12, color: "#34d399"
              } : {
                background: "#0f172a", borderColor: "#1e293b", fontSize: 12
              })
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
                    <div style={{
                      marginLeft: "auto", width: 6, height: 6, borderRadius: "50%",
                      background: TOOL_COLORS[step.tool] || "#3b82f6",
                      animation: "pulse 1s infinite"
                    }} />
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
              {step.type === "tool_result" && (
                <div>
                  <div style={{ fontSize: 10, color: "#334155", letterSpacing: "0.1em", marginBottom: 4 }}>
                    {TOOL_ICONS[step.tool]} {step.tool?.toUpperCase()} RESULT
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
              fontSize: 12, color: "#10b981",
              display: "flex", alignItems: "center", gap: 10
            }}>
              <div style={{
                width: 16, height: 16, border: "2px solid #10b981",
                borderTopColor: "transparent", borderRadius: "50%",
                animation: "spin 0.8s linear infinite"
              }} />
              Agent is working...
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
