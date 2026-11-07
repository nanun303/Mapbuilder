# Waldgenerator

Foundry-VTT-Modul (v13/v14) zum Erzeugen großer Wald-Battlemaps. Alle Bäume sind Tiles.

## Funktionen

- Bäume per Poisson-Verteilung mit natürlicher Gruppierung, reproduzierbar über einen Seed
- Kronen-Modi: Kronen über Tokens (blenden aus, wenn ein Token darunter steht), nur Stämme, oder ganze Bäume flach am Boden
- Mehrere Baumarten mit Gewichtung, Größe aus FA-Dateinamen (`_4x4`)
- Automatische Paarung von Kronen- und Stamm-Bildern über Stichwörter
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

## Installation auf The Forge

Import Wizard → `km-waldgenerator.zip` hochladen → als Custom Package importieren, danach in der Welt aktivieren.
