# Waldgenerator

Foundry-VTT-Modul (v13/v14) zum Erzeugen großer Wald-Battlemaps. Alle Bäume sind Tiles.

## Funktionen

- Bäume per Poisson-Verteilung mit natürlicher Gruppierung, reproduzierbar über einen Seed
- Kronen-Modi: Kronen über Tokens (blenden aus, wenn ein Token darunter steht), nur Stämme, oder ganze Bäume flach am Boden
- Kronen und Stämme aus getrennten Ordnern, je mit Dateifilter (`Stump_Ashen_B*`) und Gewichtung
- Standardmäßig auf FA-Nexus-Assets eingestellt (`fa-nexus-assets/Woodlands/!Wilderness/Flora/...`):
  alle Bäume als Kronen, Stümpfe Ashen/Dark/Light nur in Version B
- Größe aus FA-Dateinamen (`_6x6`), Stammgröße relativ zur Krone
- Totholz (liegende Stämme), optional als schwieriges Gelände
- Freiflächen: Zeichnungen der Szene, zufällige Lichtungen und Wege
- Wände um dicke Stämme (Bewegung und/oder Sicht)
- Unterholz mit Büschen und PF2e-Region für (größeres) schwieriges Gelände
- Bodentextur als Tile-Raster
- Vorschau auf der Karte vor dem Erzeugen
- FA-Nexus-Schatten, wenn FA Nexus aktiv ist
- „Wald entfernen“ löscht nur vom Generator erzeugte Objekte

## Bedienung

Als GM: Tile-Werkzeugleiste → Baum-Symbol, oder Einstellungen → Moduleinstellungen → Waldgenerator.
Per Makro: `game.modules.get("km-waldgenerator").api.open()`

Empfohlener Ablauf:
1. „Leere Szene erstellen“
2. Freiflächen mit dem Zeichenwerkzeug einzeichnen (optional)
3. „Vorschau“ und bei Bedarf „Neu würfeln“
4. „Wald erzeugen“

## Installation

Manifest-URL:

```
https://github.com/nanun303/Mapbuilder/releases/latest/download/module.json
```

Alternativ auf The Forge: Import Wizard → `km-waldgenerator.zip` aus dem neuesten Release hochladen → als Custom Package importieren.

## Neue Version veröffentlichen

Auf GitHub einen Release mit neuem Tag anlegen (z. B. `v0.2.0`). Die GitHub Action setzt die Version, baut die ZIP und hängt sie mit der `module.json` an den Release.
