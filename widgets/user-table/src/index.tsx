import React from "react";
import { createRoot } from "react-dom/client";

type User = { id: number; name: string };

type WidgetWindow = Window & {
  openai?: {
    toolOutput?: {
      rows?: User[];
    };
  };
};

function UserTable({ rows }: { rows: User[] }) {
  if (!rows.length) {
    return <p className="text-sm text-gray-600">No users provided.</p>;
  }

  return (
    <table className="border-collapse border border-gray-300 w-full text-sm">
      <thead>
        <tr className="bg-gray-100">
          <th className="border border-gray-300 px-2 py-1 text-left">ID</th>
          <th className="border border-gray-300 px-2 py-1 text-left">Name</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="odd:bg-white even:bg-gray-50">
            <td className="border border-gray-300 px-2 py-1">{row.id}</td>
            <td className="border border-gray-300 px-2 py-1">{row.name}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const rootElementId = "user-table-root";

function bootstrap() {
  const rows = ((window as unknown as WidgetWindow).openai?.toolOutput?.rows ?? []) as User[];
  const container = document.getElementById(rootElementId);
  if (!container) return;
  const root = createRoot(container);
  root.render(
    <div className="p-4 font-sans">
      <h2 className="font-semibold mb-2 text-base">User Table</h2>
      <UserTable rows={rows} />
    </div>
  );
}

document.addEventListener("DOMContentLoaded", bootstrap);
