# Runtime Composition

```
index.html → main.tsx → NativeHost → createNativeRuntime({api}) → <App runtime/>
simulation.html → simulationMain.tsx → createSimulationRuntime() → <App runtime/>
```
`AppRuntime = {kind:"simulation", provider} | {kind:"native", provider, identity, tenantLabel, access}`.

`createNativeRuntime` order (each step fails closed): no api → blocked; identity flag false → blocked with zero calls; `getSession` → tenant validation → blocked on failure; identity via gated identity api; principal database must equal tenant; access views (read = STORAGE∧READ, write = read∧WRITE, approve = write∧APPROVAL); gated provider.

`NativeHost` subscribes to the lifecycle bridge; before MyGeotab delivers `api` it shows a blocked runtime ("not initialized"). `App` receives the runtime as a prop and has no mode state, no AddInId state and no provider construction. A blocked or failing native runtime exposes a provider whose every method rejects with `CapabilityDeniedError`.

The default build emits only `index.html`; the simulation page is dev-only and needs `OPEX_INCLUDE_SIMULATION=1` to be built.
