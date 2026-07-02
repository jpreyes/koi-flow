// ──────────────────────────────────────────────────────────────────────────────
// koi_solve.cpp — solver SPD disperso (CSR) para koi-flow, a WASM.
//
// Núcleo IC(0)-PCG copiado de la lógica ya validada de NODEX (src/solver.cpp:
// factorIC0 / applyIC0 / csrMatvecSym, Meijerink & van der Vorst 1977), pero:
//   · DESACOPLADO del Context/skyline: recibe CSR simétrico COMPLETO directo de
//     koi (solver2d.js buildCSR), sin pasar por skyline estructural.
//   · Criterio de parada = RESIDUO PRECONDICIONADO rᵀz (koi impone Dirichlet con
//     penalti 1e12; el residuo crudo de nodex quedaría dominado por esas filas).
// Es el espejo C++ de js/lib/portico/pcg.js. Sin dependencias externas (moat).
//
// API WASM:  int solveSPD(n, nnz, rowPtr, colIdx, val, rhs, x, tol, maxIter)
//   CSR completo (ambos triángulos, filas ascendentes). Devuelve nº de iteraciones
//   (>=0) ó -1 (n<=0). x se escribe con la solución.  maxIter<=0 → 4·√n+50.
//
// Fase 1 (KOI_THREADS): la misma fuente compila en dos artefactos —
//   koi_solve.js       (single-thread, sin -pthread)
//   koi_solve_mt.js     (-pthread -DKOI_THREADS=1, WASM threads reales)
//
// POOL PERSISTENTE (no "crear hilos por iteración"): el CG llama al matvec/dot/
// axpy ~5 veces por iteración y hace ~decenas a cientos de iteraciones. Crear
// std::thread nuevos en cada una de esas llamadas (primer intento de esta Fase 1)
// midió MÁS LENTO que serial — el costo de pthread_create/join en cada llamada
// (aun con Workers pre-arrancados por PTHREAD_POOL_SIZE) domina sobre el trabajo
// real. La corrección estándar es un pool de hilos que se crea UNA vez por
// resolución y se sincroniza con un contador de generación atómico (spin, sin
// condvars): el hilo principal publica "hay trabajo nuevo" con una escritura
// release; los workers lo detectan con una lectura acquire y ejecutan su bloque.
// Ver ThreadPool más abajo.
//
// El matvec del CG usa el CSR COMPLETO de entrada (no el triángulo inferior de
// IC0) precisamente porque así cada fila i solo LEE de x[] y ESCRIBE únicamente
// y[i]: es "embarazosamente paralelo" (sin condición de carrera), a diferencia
// del matvec simétrico-por-triángulo-inferior (que escribe y[j] con j<i al
// visitar la fila i). La factorización/aplicación IC(0) (sustitución hacia
// adelante/atrás) queda SERIAL: tiene dependencias secuenciales reales
// (level-scheduling para paralelizarla es un proyecto aparte, no Fase 1).
// ──────────────────────────────────────────────────────────────────────────────
#include <emscripten.h>
#include <vector>
#include <cmath>
#include <cstdlib>
#ifdef KOI_THREADS
#include <thread>
#include <atomic>
#include <algorithm>
#endif

#ifdef KOI_THREADS
// Pool de hilos persistente para UNA resolución (vive lo que dura solveSPD).
// parallelFor(n, fn, ctx) reparte [0,n) en (nWorkers+1) bloques: los nWorkers
// hilos del pool + el propio hilo llamador (que hace el último bloque, evita
// desperdiciar un core esperando). fn recibe (lo, hi, workerId, ctx); workerId
// es útil para reducciones (cada worker escribe su suma parcial en su propio slot,
// sin colisión). Sincronización por spin sobre un contador de generación atómico
// (publish/subscribe release/acquire) — sin condvars: para trabajos de
// microsegundos a pocos milisegundos el spin evita la latencia de despertar un
// hilo dormido, que en Emscripten/WASM puede ser comparable al propio trabajo.
class ThreadPool {
public:
  using Fn = void (*)(int lo, int hi, int workerId, void* ctx);

  explicit ThreadPool(int nWorkers) : nWorkers_(nWorkers) {
    workers_.reserve(nWorkers_);
    for (int t = 0; t < nWorkers_; t++) workers_.emplace_back([this, t] { loop(t); });
  }
  ~ThreadPool() {
    stop_.store(true, std::memory_order_relaxed);
    gen_.fetch_add(1, std::memory_order_release);
    for (auto& th : workers_) th.join();
  }
  ThreadPool(const ThreadPool&) = delete;

  void parallelFor(int n, Fn fn, void* ctx) {
    int total = nWorkers_ + 1;
    if (nWorkers_ <= 0 || n < total) { fn(0, n, nWorkers_, ctx); return; }   // sin pool o n chico: todo en el llamador
    int chunk = (n + total - 1) / total;
    fn_ = fn; ctx_ = ctx; n_ = n; chunk_ = chunk;
    done_.store(0, std::memory_order_relaxed);
    gen_.fetch_add(1, std::memory_order_release);          // publica el trabajo
    int lo = nWorkers_ * chunk, hi = std::min(n, lo + chunk);
    if (lo < hi) fn(lo, hi, nWorkers_, ctx);                // el llamador hace el último bloque
    while (done_.load(std::memory_order_acquire) < nWorkers_) { /* spin */ }
  }

  int workers() const { return nWorkers_; }

private:
  void loop(int t) {
    int seen = 0;
    for (;;) {
      int g;
      while ((g = gen_.load(std::memory_order_acquire)) == seen) { /* spin */ }
      seen = g;
      if (stop_.load(std::memory_order_relaxed)) return;
      int lo = t * chunk_, hi = std::min(n_, lo + chunk_);
      if (lo < hi) fn_(lo, hi, t, ctx_);
      done_.fetch_add(1, std::memory_order_acq_rel);
    }
  }

  int nWorkers_;
  std::vector<std::thread> workers_;
  std::atomic<int> gen_{0};
  std::atomic<int> done_{0};
  std::atomic<bool> stop_{false};
  Fn fn_ = nullptr; void* ctx_ = nullptr; int n_ = 0, chunk_ = 0;
};
#endif

// Triángulo inferior (incl. diagonal, diagonal ÚLTIMA por fila) del CSR simétrico
// completo → CSR inferior (row-major, columnas ascendentes). Solo no-ceros + diag.
static void extractLowerCSR(int n, const int* rp0, const int* ci0, const double* av0,
                            std::vector<int>& rp, std::vector<int>& ci, std::vector<double>& av) {
  rp.assign(n + 1, 0);
  for (int i = 0; i < n; i++) { int c = 0;
    for (int p = rp0[i]; p < rp0[i + 1]; p++) { int j = ci0[p]; if (j < i && av0[p] != 0.0) c++; else if (j == i) c++; }
    rp[i + 1] = c; }
  for (int i = 0; i < n; i++) rp[i + 1] += rp[i];
  ci.resize(rp[n]); av.resize(rp[n]);
  for (int i = 0; i < n; i++) { int p = rp[i]; double diag = 0.0; bool hasDiag = false;
    // columnas j<i (ascendentes) primero, luego la diagonal al final
    for (int q = rp0[i]; q < rp0[i + 1]; q++) { int j = ci0[q];
      if (j < i && av0[q] != 0.0) { ci[p] = j; av[p] = av0[q]; p++; }
      else if (j == i) { diag = av0[q]; hasDiag = true; } }
    (void)hasDiag; ci[p] = i; av[p] = diag; p++; }
}

// IC(0): factoriza `lval` (CSR inferior, diag última) con shift diagonal opcional.
// A + shift·diag(A). Devuelve false ante pivote no positivo (breakdown).
static bool factorIC0(const std::vector<int>& rp, const std::vector<int>& ci,
                      const std::vector<double>& av, std::vector<double>& lval, double shift) {
  int n = (int)rp.size() - 1;
  lval = av;
  if (shift > 0.0) for (int i = 0; i < n; i++) lval[rp[i + 1] - 1] *= (1.0 + shift);
  auto dotCommon = [&](int i, int j, int limit) {
    int pi = rp[i], pj = rp[j]; double s = 0.0;
    while (pi < rp[i + 1] && pj < rp[j + 1]) {
      int a1 = ci[pi], a2 = ci[pj]; if (a1 >= limit || a2 >= limit) break;
      if (a1 == a2) { s += lval[pi] * lval[pj]; pi++; pj++; }
      else if (a1 < a2) pi++; else pj++;
    } return s; };
  for (int i = 0; i < n; i++)
    for (int p = rp[i]; p < rp[i + 1]; p++) {
      int j = ci[p];
      if (j < i) { double ljj = lval[rp[j + 1] - 1]; if (fabs(ljj) < 1e-300) return false;
        lval[p] = (lval[p] - dotCommon(i, j, j)) / ljj; }
      else { double s = lval[p] - dotCommon(i, i, i); if (s <= 0.0) return false; lval[p] = sqrt(s); }
    }
  return true;
}

// M⁻¹r = (L·Lᵀ)⁻¹r : forward L y=r, back Lᵀ z=y (CSR inferior, diag última).
// Serial (dependencia secuencial real, ver nota de cabecera).
static void applyIC0(const std::vector<int>& rp, const std::vector<int>& ci, const std::vector<double>& lval,
                     const double* r, double* z) {
  int n = (int)rp.size() - 1;
  for (int i = 0; i < n; i++) { double s = r[i];
    for (int p = rp[i]; p < rp[i + 1] - 1; p++) s -= lval[p] * z[ci[p]];
    z[i] = s / lval[rp[i + 1] - 1]; }
  for (int i = n - 1; i >= 0; i--) { z[i] /= lval[rp[i + 1] - 1];
    for (int p = rp[i]; p < rp[i + 1] - 1; p++) z[ci[p]] -= lval[p] * z[i]; }
}

// ── Camino SERIAL (single-thread, o KOI_THREADS pero n chico): idéntico al
// original — cero riesgo de romper lo ya validado en Fase 0. ──────────────────
static void csrMatvecFullSerial(int n, const int* rp, const int* ci, const double* av, const double* x, double* y) {
  for (int i = 0; i < n; i++) {
    double s = 0.0;
    for (int p = rp[i]; p < rp[i + 1]; p++) s += av[p] * x[ci[p]];
    y[i] = s;
  }
}

int EMSCRIPTEN_KEEPALIVE solveSPDcore(int n, const int* rowPtr, const int* colIdx, const double* val,
                                       const double* rhs, double* x, double tol, int maxIter,
                                       int nThreads);

extern "C" {

EMSCRIPTEN_KEEPALIVE
int solveSPD(int n, int /*nnz*/, const int* rowPtr, const int* colIdx, const double* val,
             const double* rhs, double* x, double tol, int maxIter) {
#ifdef KOI_THREADS
  unsigned hc = std::thread::hardware_concurrency();
  int nt = hc ? (int)hc : 4; if (nt > 8) nt = 8;
#else
  int nt = 1;
#endif
  return solveSPDcore(n, rowPtr, colIdx, val, rhs, x, tol, maxIter, nt);
}

} // extern "C"

// ── Contextos de trabajo paralelo (Fase 1) ──────────────────────────────────
#ifdef KOI_THREADS
struct MvCtx { int n; const int* rp; const int* ci; const double* av; const double* x; double* y; };
static void jobMatvec(int lo, int hi, int, void* vc) {
  auto* c = (MvCtx*)vc;
  for (int i = lo; i < hi; i++) { double s = 0.0; for (int p = c->rp[i]; p < c->rp[i + 1]; p++) s += c->av[p] * c->x[c->ci[p]]; c->y[i] = s; }
}
struct DotCtx { const double* a; const double* b; double* partial; };
static void jobDot(int lo, int hi, int wid, void* vc) {
  auto* c = (DotCtx*)vc; double s = 0.0; for (int i = lo; i < hi; i++) s += c->a[i] * c->b[i]; c->partial[wid] = s;
}
struct AxpyCtx { double* x; double* r; const double* p; const double* Ap; double alpha; };
static void jobAxpy(int lo, int hi, int, void* vc) {
  auto* c = (AxpyCtx*)vc; for (int i = lo; i < hi; i++) { c->x[i] += c->alpha * c->p[i]; c->r[i] -= c->alpha * c->Ap[i]; }
}
struct PUpdCtx { double* p; const double* z; double beta; };
static void jobPUpd(int lo, int hi, int, void* vc) {
  auto* c = (PUpdCtx*)vc; for (int i = lo; i < hi; i++) c->p[i] = c->z[i] + c->beta * c->p[i];
}
#endif

int solveSPDcore(int n, const int* rowPtr, const int* colIdx, const double* val,
                 const double* rhs, double* x, double tol, int maxIter, int nThreads) {
  if (n <= 0) return -1;
  if (tol <= 0.0) tol = 1e-8;
  if (maxIter <= 0) maxIter = (int)(4.0 * sqrt((double)n) + 50.0);

  std::vector<int> rp, ci; std::vector<double> av;
  extractLowerCSR(n, rowPtr, colIdx, val, rp, ci, av);

  // Precondicionador: IC(0) con shifts crecientes; fallback a Jacobi si rompe.
  std::vector<double> lval; bool useIC = false;
  const double shifts[] = {0.0, 1e-3, 1e-2, 1e-1, 5e-1, 1.0};
  for (double sh : shifts) if (factorIC0(rp, ci, av, lval, sh)) { useIC = true; break; }
  std::vector<double> Minv;
  if (!useIC) { Minv.assign(n, 1.0); for (int i = 0; i < n; i++) { double d = av[rp[i + 1] - 1]; if (fabs(d) > 1e-300) Minv[i] = 1.0 / d; } }
  auto precond = [&](const double* r, double* z) {
    if (useIC) applyIC0(rp, ci, lval, r, z);
    else for (int i = 0; i < n; i++) z[i] = Minv[i] * r[i]; };

  std::vector<double> r(n), z(n), p(n), Ap(n);
  for (int i = 0; i < n; i++) { x[i] = 0.0; r[i] = rhs[i]; }

#ifdef KOI_THREADS
  // Pool solo si vale la pena: crear/destruir hilos también cuesta, así que para
  // problemas chicos (donde igual el CG entero dura <1ms) nWorkers=0 → todo serial.
  int nWorkers = (nThreads > 1 && n >= 8000) ? (nThreads - 1) : 0;
  ThreadPool pool(nWorkers);
  std::vector<double> partial(nWorkers + 1, 0.0);
  auto matvec = [&](const double* xx, double* yy) {
    MvCtx c{n, rowPtr, colIdx, val, xx, yy};
    pool.parallelFor(n, jobMatvec, &c);
  };
  auto dot = [&](const double* a, const double* b) -> double {
    DotCtx c{a, b, partial.data()};
    pool.parallelFor(n, jobDot, &c);
    double s = 0.0; for (int t = 0; t <= nWorkers; t++) s += partial[t]; return s;
  };
  auto axpy = [&](double alpha) {
    AxpyCtx c{x, r.data(), p.data(), Ap.data(), alpha};
    pool.parallelFor(n, jobAxpy, &c);
  };
  auto pUpdate = [&](double beta) {
    PUpdCtx c{p.data(), z.data(), beta};
    pool.parallelFor(n, jobPUpd, &c);
  };
#else
  auto matvec = [&](const double* xx, double* yy) { csrMatvecFullSerial(n, rowPtr, colIdx, val, xx, yy); };
  auto dot = [&](const double* a, const double* b) -> double { double s = 0.0; for (int i = 0; i < n; i++) s += a[i] * b[i]; return s; };
  auto axpy = [&](double alpha) { for (int i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; } };
  auto pUpdate = [&](double beta) { for (int i = 0; i < n; i++) p[i] = z[i] + beta * p[i]; };
#endif

  precond(r.data(), z.data());
  for (int i = 0; i < n; i++) p[i] = z[i];
  double rz = dot(r.data(), z.data());
  const double rz0 = (rz > 0.0) ? rz : 1.0;
  const double stop = tol * tol * rz0;   // residuo PRECONDICIONADO relativo

  int iter = 0;
  for (; iter < maxIter; iter++) {
    matvec(p.data(), Ap.data());
    double pAp = dot(p.data(), Ap.data());
    if (fabs(pAp) < 1e-300) break;
    double alpha = rz / pAp;
    axpy(alpha);
    precond(r.data(), z.data());
    double rzNew = dot(r.data(), z.data());
    if (rzNew < stop) { iter++; break; }
    double beta = (rz != 0.0) ? rzNew / rz : 0.0; rz = rzNew;
    pUpdate(beta);
  }
  return iter;
}
