# River Pulse: 2D pollutant transport

A small, dependency-free browser visualization of a dissolved pollutant moving through a tidal river. It solves the depth-averaged, two-dimensional advection-diffusion equation on a rectangular reach and animates the concentration field, river-centerline profile, plume centroid, and the instantaneous tidal velocity.

## Run it

From this directory, start a local static web server:

```powershell
python -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000) in a browser. The app uses native JavaScript modules; serving the directory over HTTP avoids browser restrictions on opening modules directly from disk.

Run the numerical tests with Node.js:

```powershell
npm test
```

## Equations and sign convention

The horizontal coordinate `x` points **upstream** from the downstream river mouth; `y` spans the channel width. Positive `u` therefore means upstream transport. The model solves

```text
∂C/∂t + u(t) ∂C/∂x = D (∂²C/∂x² + ∂²C/∂y²)
u(t) = U_river + A_tide sin(2πt/T + φ)
v   = 0
```

`C` is pollutant concentration, `U_river` is the mean downstream river velocity (negative with this sign convention), `A_tide` is the prescribed tidal-velocity amplitude, `T` is the tidal period, and `D` is a constant molecular diffusion coefficient. The phase starts at peak flood tide so the default release initially travels upstream. When the tide weakens, the river current can take the plume downstream again; the displayed arrows, velocity, and flood/ebb/slack label update with the instantaneous velocity.

The advection term is advanced with a first-order upwind finite-volume flux; diffusion uses centered differences. The explicit time step is restricted by a conservative advection-diffusion stability bound. The river banks have no-flux (zero-normal-gradient) boundaries. Both river ends are open with zero-gradient inflow and advective outflow, so pollutant may leave the modeled reach. The initial 10 kg release is a finite-width Gaussian, normalized so its depth-integrated mass is 10 kg.

## Scope and limitations

- No turbulence model, eddy viscosity, or turbulent-diffusion coefficient is used. The default `D = 10⁻⁹ m²/s` is molecular-scale; increasing `D` is only a sensitivity experiment and is not a turbulence closure.
- The tidal velocity is prescribed as a spatially uniform sinusoid. This is a transport demonstration, not a shallow-water momentum solution or a site-calibrated tide prediction.
- This is a depth-averaged, constant-depth channel. It omits vertical concentration gradients, river bends, variable bathymetry, pollutant reactions, and external source inputs.
- Consequently, the model illustrates how a reversing tide can carry pollutant upstream, but it does not claim to predict a particular real river without measured, site-specific flow and dispersion data.
