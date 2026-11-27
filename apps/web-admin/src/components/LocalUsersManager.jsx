import React, { useEffect, useState } from "react";
import { UserPlus, KeyRound, Power, RefreshCw } from "lucide-react";

export default function LocalUsersManager({ apiOrigin, getAuthHeaders, authMode }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("employee");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);

  const [resetUserId, setResetUserId] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  const fetchLocalUsers = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiOrigin}/auth/local-users`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLocalUsers();
  }, []);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setError("");
    setFeedback("");
    setCreating(true);
    try {
      const res = await fetch(`${apiOrigin}/auth/local-users`, {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          fullName: fullName.trim(),
          role,
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setEmail("");
      setFullName("");
      setPassword("");
      setRole("employee");
      setFeedback(`Compte local créé pour ${data.user?.email}.`);
      await fetchLocalUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (user) => {
    setError("");
    setFeedback("");
    try {
      const res = await fetch(`${apiOrigin}/auth/local-users/${user.id}`, {
        method: "PATCH",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ is_active: !user.is_active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? data.user : u)));
      setFeedback(
        `${user.email} est désormais ${data.user.is_active ? "actif" : "désactivé"}.`
      );
    } catch (err) {
      setError(err.message);
    }
  };

  const handleResetPassword = async (e, userId) => {
    e.preventDefault();
    setError("");
    setFeedback("");
    setResetting(true);
    try {
      const res = await fetch(`${apiOrigin}/auth/local-users/${userId}/reset-password`, {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResetUserId(null);
      setNewPassword("");
      setFeedback(`Mot de passe réinitialisé pour ${data.user?.email} (sessions actives révoquées).`);
    } catch (err) {
      setError(err.message);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-sm text-slate-900">
            Utilisateurs locaux (mode Email + Mot de passe)
          </h2>
          <p className="text-xs text-slate-500">
            {authMode === "sso"
              ? "L'organisation est actuellement en mode SSO : les comptes locaux restent consultables mais le SSO est prioritaire."
              : "Gérez les comptes collaborateurs locaux, leur statut actif/inactif et la réinitialisation de mot de passe."}
          </p>
        </div>
        <button
          type="button"
          onClick={fetchLocalUsers}
          className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualiser
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2 text-xs">
          {error}
        </div>
      )}
      {feedback && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2 text-xs">
          {feedback}
        </div>
      )}

      <form onSubmit={handleCreateUser} className="grid md:grid-cols-5 gap-2.5 pt-2 border-t border-slate-100">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="prenom.nom@atelier-sud.fr"
          className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs"
        />
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Nom complet"
          className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white"
        >
          <option value="employee">Salarié (employee)</option>
          <option value="admin_rh">Admin RH (admin_rh)</option>
          <option value="admin_dpo">Admin DPO (admin_dpo)</option>
          <option value="admin_rssi">Admin RSSI (admin_rssi)</option>
        </select>
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Mot de passe (8 car. min)"
          className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs"
        />
        <button
          type="submit"
          disabled={creating}
          className="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 flex items-center justify-center gap-1.5"
        >
          <UserPlus className="w-3.5 h-3.5" />
          {creating ? "Création..." : "Ajouter"}
        </button>
      </form>

      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
            <tr>
              <th className="py-2 px-3 font-medium">Utilisateur</th>
              <th className="py-2 px-3 font-medium">Rôle</th>
              <th className="py-2 px-3 font-medium">Statut</th>
              <th className="py-2 px-3 font-medium">Dernière connexion</th>
              <th className="py-2 px-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-4 px-3 text-center text-slate-500">
                  {loading ? "Chargement..." : "Aucun utilisateur local enregistré."}
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <React.Fragment key={u.id}>
                  <tr className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-slate-900">{u.full_name || "—"}</div>
                      <div className="text-slate-500 font-mono text-[11px]">{u.email}</div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700">{u.role}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          u.is_active
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-slate-100 text-slate-600 border border-slate-200"
                        }`}
                      >
                        {u.is_active ? "Actif" : "Désactivé"}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-500">
                      {u.last_login_at ? new Date(u.last_login_at).toLocaleString("fr-FR") : "Jamais"}
                    </td>
                    <td className="py-2.5 px-3 text-right space-x-1.5 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => {
                          setResetUserId((cur) => (cur === u.id ? null : u.id));
                          setNewPassword("");
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700"
                        title="Réinitialiser le mot de passe"
                      >
                        <KeyRound className="w-3 h-3" />
                        Reset MDP
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(u)}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-white ${
                          u.is_active
                            ? "bg-amber-600 hover:bg-amber-500"
                            : "bg-emerald-600 hover:bg-emerald-500"
                        }`}
                      >
                        <Power className="w-3 h-3" />
                        {u.is_active ? "Désactiver" : "Activer"}
                      </button>
                    </td>
                  </tr>
                  {resetUserId === u.id && (
                    <tr className="bg-slate-50">
                      <td colSpan={5} className="py-2.5 px-3">
                        <form
                          onSubmit={(e) => handleResetPassword(e, u.id)}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <span className="text-xs font-medium text-slate-700">
                            Nouveau mot de passe pour {u.email} :
                          </span>
                          <input
                            type="password"
                            required
                            minLength={8}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="8 caractères minimum"
                            className="border border-slate-300 rounded-lg px-2.5 py-1 text-xs bg-white"
                          />
                          <button
                            type="submit"
                            disabled={resetting}
                            className="rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 text-xs font-medium"
                          >
                            {resetting ? "Validation..." : "Valider"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setResetUserId(null)}
                            className="text-xs text-slate-500 hover:text-slate-800 px-2 py-1"
                          >
                            Annuler
                          </button>
                        </form>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
