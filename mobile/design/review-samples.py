# Synthesises the App Review sample tracks: Minuet in G (BWV Anh. 114, public domain), harpsichord-like, at a given A.
import numpy as np, wave, sys
SR = 44100
N = {'D3':-19,'F#3':-15,'G3':-14,'A3':-12,'B3':-10,'C4':-9,'D4':-7,'F#4':-3,'G4':-2,'A4':0,'B4':2,'C5':3,'D5':5,'E5':7,'F#5':9,'G5':10}
q, e, dh = 1, .5, 3
A = [('D5',q),('G4',e),('A4',e),('B4',e),('C5',e)]
B = [('D5',q),('G4',q),('G4',q)]
C = [('E5',q),('C5',e),('D5',e),('E5',e),('F#5',e)]
D = [('G5',q),('G4',q),('G4',q)]
E = [('C5',q),('D5',e),('C5',e),('B4',e),('A4',e)]
F = [('B4',q),('C5',e),('B4',e),('A4',e),('G4',e)]
G = [('F#4',q),('G4',e),('A4',e),('B4',e),('G4',e)]
H1 = [('A4',dh)]
H2 = [('A4',q),('B4',e),('A4',e),('G4',e),('F#4',e)]
H3 = [('G4',dh)]
mel = A+B+C+D+E+F+G+H1 + A+B+C+D+E+F+H2+H3
bass = ['G3','B3','C4','B3','A3','G3','D3','D3', 'G3','B3','C4','B3','A3','G3','D3','G3']
def tone(f, dur, amp):
    t = np.arange(int(SR*dur))/SR; s = np.zeros_like(t)
    for k in range(1, 9): s += (0.6**(k-1)) * np.sin(2*np.pi*f*k*t) * np.exp(-t*(1.2+0.6*k))
    a = np.minimum(1, t/0.004); r = np.minimum(1, (dur-t)/0.03)
    return amp*s*a*r
def render(a4, bpm=112):
    beat = 60/bpm; out = np.zeros(int(SR*(len(bass)*3*beat*2+2)))
    for rep in range(2):
        t0 = rep*len(bass)*3*beat; t = t0
        for n,d in mel:
            x = tone(a4*2**(N[n]/12), d*beat+0.25, .32); i = int(t*SR); out[i:i+len(x)] += x; t += d*beat
        for b,n in enumerate(bass):
            x = tone(a4*2**(N[n]/12), 3*beat+0.3, .26); i = int((t0+b*3*beat)*SR); out[i:i+len(x)] += x
    out /= np.abs(out).max()*1.12
    return (np.repeat(out[:,None],2,1)*32767).astype('<i2')
for a4, name in [(440,'a440'),(432,'a432')]:
    with wave.open(f'{sys.argv[1]}/minuet-{name}.wav','wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(render(a4).tobytes())
