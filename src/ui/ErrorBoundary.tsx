import { Component, type ReactNode } from 'react';

/** Filet de sécurité de l'interface : un bug d'affichage ne doit pas faire perdre la partie. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="modal-back">
        <div className="modal" role="alertdialog" aria-label="Erreur d’affichage">
          <h2>Un parchemin s’est déchiré</h2>
          <p>L’interface a rencontré une erreur : <code>{this.state.error.message}</code></p>
          <p className="muted">La partie est sauvegardée automatiquement chaque matin. Recharger la page reprend depuis la dernière sauvegarde automatique.</p>
          <div className="save-row">
            <button className="btn" onClick={() => this.setState({ error: null })}>Réessayer</button>
            <button className="btn ghost" onClick={() => window.location.reload()}>Recharger la page</button>
          </div>
        </div>
      </div>
    );
  }
}
