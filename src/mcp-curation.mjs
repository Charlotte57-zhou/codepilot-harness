const featuredMcpProducts = Object.freeze([
  {
    id: "github",
    title: "GitHub",
    category: "developer",
    description: "检索代码、管理 Issue 与 Pull Request，并衔接 GitHub Actions。",
    publisher: "GitHub",
    provenance: "official",
    registryName: null,
    serverName: "github",
    authMode: "token",
    availability: "connectable",
    serverUrl: "https://api.githubcopilot.com/mcp/"
  },
  {
    id: "figma",
    title: "Figma",
    category: "developer",
    description: "把设计稿、组件与设计上下文带入编码工作流。",
    publisher: "Figma",
    provenance: "official",
    registryName: "com.figma.mcp/mcp",
    serverName: "com.figma.mcp/mcp",
    authMode: "oauth",
    availability: "connectable",
    serverUrl: "https://mcp.figma.com/mcp"
  },
  {
    id: "linear",
    title: "Linear",
    category: "developer",
    description: "查询和维护团队、项目、Cycle 与 Issue。",
    publisher: "Linear",
    provenance: "official",
    registryName: "app.linear/linear",
    serverName: "app.linear/linear",
    authMode: "oauth",
    availability: "connectable",
    serverUrl: "https://mcp.linear.app/mcp"
  },
  {
    id: "notion",
    title: "Notion",
    category: "productivity",
    description: "搜索工作区，创建和更新页面、数据库与项目文档。",
    publisher: "Notion",
    provenance: "official",
    registryName: "com.notion/mcp",
    serverName: "com.notion/mcp",
    authMode: "oauth",
    availability: "connectable",
    serverUrl: "https://mcp.notion.com/mcp"
  }
]);

export function getFeaturedMcpProducts() {
  return featuredMcpProducts.map((product) => ({ ...product }));
}

export function getFeaturedMcpProduct(id) {
  const product = featuredMcpProducts.find((candidate) => candidate.id === id);
  return product ? { ...product } : null;
}
