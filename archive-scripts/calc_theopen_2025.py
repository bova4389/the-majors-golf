"""
Calculate The Open Championship 2025 pool standings and output JS constants.
"""

# ---- Field scores (from THEOPEN_2025_FIELD in standings.js) ----
# isMC=True means missed cut (r3, r4 will be replaced with 10 penalty each)
FIELD = {
    'Scottie Scheffler':    {'r1': -3, 'r2': -7, 'r3': -4, 'r4': -3, 'mc': False},
    'Harris English':       {'r1': -4, 'r2': -1, 'r3': -3, 'r4': -5, 'mc': False},
    'Chris Gotterup':       {'r1':  1, 'r2': -6, 'r3': -3, 'r4': -4, 'mc': False},
    'Wyndham Clark':        {'r1':  5, 'r2': -5, 'r3': -5, 'r4': -6, 'mc': False},
    'Rory McIlroy':         {'r1': -1, 'r2': -2, 'r3': -5, 'r4': -2, 'mc': False},
    'Robert MacIntyre':     {'r1':  0, 'r2': -5, 'r3': -1, 'r4': -4, 'mc': False},
    'Russell Henley':       {'r1':  1, 'r2': -1, 'r3': -6, 'r4': -3, 'mc': False},
    'Brian Harman':         {'r1': -2, 'r2': -6, 'r3':  2, 'r4': -3, 'mc': False},
    'Bryson DeChambeau':    {'r1':  7, 'r2': -6, 'r3': -3, 'r4': -7, 'mc': False},
    'Rickie Fowler':        {'r1': -2, 'r2':  1, 'r3': -1, 'r4': -6, 'mc': False},
    'Nicolai Hojgaard':     {'r1': -2, 'r2': -2, 'r3': -2, 'r4': -2, 'mc': False},
    'Justin Rose':          {'r1': -2, 'r2':  0, 'r3': -3, 'r4': -2, 'mc': False},
    'Rasmus Hojgaard':      {'r1': -2, 'r2': -3, 'r3': -1, 'r4': -1, 'mc': False},
    'Tommy Fleetwood':      {'r1':  2, 'r2': -3, 'r3': -2, 'r4': -4, 'mc': False},
    'Maverick McNealy':     {'r1': -2, 'r2':  3, 'r3': -2, 'r4': -5, 'mc': False},
    'JJ Spaun':             {'r1':  2, 'r2': -2, 'r3': -3, 'r4': -3, 'mc': False},
    'Lucas Glover':         {'r1': -2, 'r2':  1, 'r3': -3, 'r4': -2, 'mc': False},
    'Ludvig Aberg':         {'r1':  2, 'r2': -4, 'r3': -3, 'r4': -1, 'mc': False},
    'Oliver Lindell':       {'r1':  1, 'r2': -3, 'r3': -3, 'r4':  0, 'mc': False},
    'Daniel Berger':        {'r1':  1, 'r2': -1, 'r3': -1, 'r4': -3, 'mc': False},
    'Akshay Bhatia':        {'r1':  2, 'r2': -3, 'r3': -1, 'r4': -2, 'mc': False},
    'Kristoffer Reitan':    {'r1':  1, 'r2': -3, 'r3': -3, 'r4':  1, 'mc': False},
    'Keegan Bradley':       {'r1':  1, 'r2': -4, 'r3': -1, 'r4':  0, 'mc': False},
    'Jon Rahm':             {'r1': -1, 'r2':  1, 'r3': -2, 'r4': -1, 'mc': False},
    'Sergio Garcia':        {'r1': -1, 'r2':  2, 'r3': -1, 'r4': -3, 'mc': False},
    'Shane Lowry':          {'r1': -1, 'r2':  1, 'r3':  3, 'r4': -5, 'mc': False},
    'Takumi Kanaya':        {'r1':  0, 'r2':  1, 'r3': -2, 'r4': -1, 'mc': False},
    'Jordan Spieth':        {'r1':  2, 'r2': -2, 'r3':  1, 'r4': -3, 'mc': False},
    'Matthew Jordan':       {'r1': -3, 'r2':  1, 'r3':  2, 'r4': -1, 'mc': False},
    'Thriston Lawrence':    {'r1':  2, 'r2': -1, 'r3': -3, 'r4':  1, 'mc': False},
    'Sam Burns':            {'r1': -1, 'r2': -2, 'r3':  1, 'r4':  1, 'mc': False},
    'Jordan Smith':         {'r1':  0, 'r2': -3, 'r3':  1, 'r4':  1, 'mc': False},
    'Marc Leishman':        {'r1':  2, 'r2': -3, 'r3': -3, 'r4':  4, 'mc': False},
    'Sungjae Im':           {'r1':  0, 'r2':  0, 'r3': -4, 'r4':  4, 'mc': False},
    'Jhonattan Vegas':      {'r1':  1, 'r2': -1, 'r3': -1, 'r4':  2, 'mc': False},
    'Phil Mickelson':       {'r1': -1, 'r2':  1, 'r3':  5, 'r4': -4, 'mc': False},
    'Tony Finau':           {'r1': -1, 'r2': -3, 'r3':  1, 'r4':  4, 'mc': False},
    'Antoine Rozner':       {'r1':  1, 'r2': -1, 'r3':  2, 'r4':  0, 'mc': False},
    'Dean Burmester':       {'r1':  0, 'r2':  0, 'r3':  5, 'r4': -2, 'mc': False},
    'Viktor Hovland':       {'r1':  2, 'r2': -2, 'r3':  2, 'r4':  2, 'mc': False},
    'Francesco Molinari':   {'r1':  1, 'r2':  0, 'r3':  0, 'r4':  3, 'mc': False},
    'Andrew Novak':         {'r1':  0, 'r2':  1, 'r3':  3, 'r4':  0, 'mc': False},
    'Ryggs Johnston':       {'r1':  3, 'r2': -5, 'r3':  3, 'r4':  3, 'mc': False},
    'Jacob Skov Olesen':    {'r1': -4, 'r2':  5, 'r3':  2, 'r4':  3, 'mc': False},
    'Matthias Schmid':      {'r1':  2, 'r2': -1, 'r3':  8, 'r4': -1, 'mc': False},
    'Sebastian Soderberg':  {'r1':  2, 'r2': -1, 'r3':  4, 'r4':  6, 'mc': False},
    # MC players (r3/r4 will be replaced with 10 penalty)
    'Matteo Manassero':     {'r1':  2, 'r2':  0, 'r3': 10, 'r4': 10, 'mc': True},
    'Joaquin Niemann':      {'r1': -1, 'r2':  3, 'r3': 10, 'r4': 10, 'mc': True},
    'Rikuya Hoshino':       {'r1':  3, 'r2': -1, 'r3': 10, 'r4': 10, 'mc': True},
    'Jason Day':            {'r1':  2, 'r2':  0, 'r3': 10, 'r4': 10, 'mc': True},
    'Ben Griffin':          {'r1':  3, 'r2': -1, 'r3': 10, 'r4': 10, 'mc': True},
    'Denny McCarthy':       {'r1':  3, 'r2':  0, 'r3': 10, 'r4': 10, 'mc': True},
    'Taylor Pendrith':      {'r1':  4, 'r2': -1, 'r3': 10, 'r4': 10, 'mc': True},
    'Ethan Fang':           {'r1':  4, 'r2': -1, 'r3': 10, 'r4': 10, 'mc': True},
    'Tom McKibbin':         {'r1':  1, 'r2':  2, 'r3': 10, 'r4': 10, 'mc': True},
    'Julien Guerrier':      {'r1':  2, 'r2':  1, 'r3': 10, 'r4': 10, 'mc': True},
    'Matt McCarty':         {'r1':  0, 'r2':  3, 'r3': 10, 'r4': 10, 'mc': True},
    'Si Woo Kim':           {'r1':  3, 'r2':  0, 'r3': 10, 'r4': 10, 'mc': True},
    'Carlos Ortiz':         {'r1':  4, 'r2': -1, 'r3': 10, 'r4': 10, 'mc': True},
    'Brian Campbell':       {'r1':  2, 'r2':  1, 'r3': 10, 'r4': 10, 'mc': True},
    'Zach Johnson':         {'r1': -1, 'r2':  4, 'r3': 10, 'r4': 10, 'mc': True},
    'Max Greyserman':       {'r1':  7, 'r2': -4, 'r3': 10, 'r4': 10, 'mc': True},
    'Patrick Cantlay':      {'r1':  2, 'r2':  1, 'r3': 10, 'r4': 10, 'mc': True},
    'Thorbjorn Olesen':     {'r1':  1, 'r2':  3, 'r3': 10, 'r4': 10, 'mc': True},
    'Marco Penge':          {'r1':  3, 'r2':  1, 'r3': 10, 'r4': 10, 'mc': True},
    'Cameron Young':        {'r1':  3, 'r2':  1, 'r3': 10, 'r4': 10, 'mc': True},
    'Young-han Song':       {'r1':  2, 'r2':  2, 'r3': 10, 'r4': 10, 'mc': True},
    'Nico Echavarria':      {'r1':  1, 'r2':  3, 'r3': 10, 'r4': 10, 'mc': True},
    'Michael Kim':          {'r1':  3, 'r2':  1, 'r3': 10, 'r4': 10, 'mc': True},
    'John Catlin':          {'r1':  7, 'r2': -3, 'r3': 10, 'r4': 10, 'mc': True},
    'Chris Kirk':           {'r1':  2, 'r2':  3, 'r3': 10, 'r4': 10, 'mc': True},
    'Byeong Hun An':        {'r1':  5, 'r2':  0, 'r3': 10, 'r4': 10, 'mc': True},
    'Patrick Reed':         {'r1':  6, 'r2': -1, 'r3': 10, 'r4': 10, 'mc': True},
    'Matthieu Pavon':       {'r1':  5, 'r2':  0, 'r3': 10, 'r4': 10, 'mc': True},
    'Shaun Norris':         {'r1':  1, 'r2':  4, 'r3': 10, 'r4': 10, 'mc': True},
    'Darren Clarke':        {'r1':  4, 'r2':  2, 'r3': 10, 'r4': 10, 'mc': True},
    'Justin Hastings':      {'r1':  3, 'r2':  3, 'r3': 10, 'r4': 10, 'mc': True},
    'JT Poston':            {'r1':  1, 'r2':  6, 'r3': 10, 'r4': 10, 'mc': True},
    'Sahith Theegala':      {'r1':  4, 'r2':  3, 'r3': 10, 'r4': 10, 'mc': True},
    'Mackenzie Hughes':     {'r1':  8, 'r2': -1, 'r3': 10, 'r4': 10, 'mc': True},
    'Brooks Koepka':        {'r1':  4, 'r2':  3, 'r3': 10, 'r4': 10, 'mc': True},
    'Ryan Peake':           {'r1':  6, 'r2':  2, 'r3': 10, 'r4': 10, 'mc': True},
    'Cameron Smith':        {'r1':  1, 'r2':  7, 'r3': 10, 'r4': 10, 'mc': True},
    'Curtis Luck':          {'r1':  9, 'r2': -1, 'r3': 10, 'r4': 10, 'mc': True},
    'Padraig Harrington':   {'r1':  4, 'r2':  5, 'r3': 10, 'r4': 10, 'mc': True},
    'Connor Graham':        {'r1':  2, 'r2':  8, 'r3': 10, 'r4': 10, 'mc': True},
    'KJ Choi':              {'r1': 10, 'r2':  3, 'r3': 10, 'r4': 10, 'mc': True},
}

# Canonical name alias map: picks name -> field key
NAME_MAP = {
    'Scottie Scheffler': 'Scottie Scheffler',
    'Rory McIlroy': 'Rory McIlroy',
    'Brooks Koepka': 'Brooks Koepka',
    'Wyndham Clark': 'Wyndham Clark',
    'Lucas Glover': 'Lucas Glover',
    'Sahith Theegala': 'Sahith Theegala',
    'Connor Graham (a)': 'Connor Graham',
    'Jordan Spieth': 'Jordan Spieth',
    'Rickie Fowler': 'Rickie Fowler',
    'Michael Kim': 'Michael Kim',
    'Zach Johnson': 'Zach Johnson',
    'Darren Clarke': 'Darren Clarke',
    'Shane Lowry': 'Shane Lowry',
    'J.T. Poston': 'JT Poston',
    'Matthieu Pavon': 'Matthieu Pavon',
    'Julien Guerrier': 'Julien Guerrier',
    'Viktor Hovland': 'Viktor Hovland',
    'Brian Harman': 'Brian Harman',
    'Thorbjorn Olesen': 'Thorbjorn Olesen',
    'Tom McKibbin': 'Tom McKibbin',
    'Brian Campbell': 'Brian Campbell',
    'Sebastian Soderberg': 'Sebastian Soderberg',
    'Russell Henley': 'Russell Henley',
    'Sungjae Im': 'Sungjae Im',
    'Jhonattan Vegas': 'Jhonattan Vegas',
    'Shaun Norris': 'Shaun Norris',
    'Patrick Reed': 'Patrick Reed',
    'Akshay Bhatia': 'Akshay Bhatia',
    'Rikuya Hoshino': 'Rikuya Hoshino',
    'J.J. Spaun': 'JJ Spaun',
    'Chris Kirk': 'Chris Kirk',
    'Nico Echavarria': 'Nico Echavarria',
    'Oliver Lindell': 'Oliver Lindell',
    'Si Woo Kim': 'Si Woo Kim',
    'Dean Burmester': 'Dean Burmester',
    'Kristoffer Reitan': 'Kristoffer Reitan',
    'Joaquin Niemann': 'Joaquin Niemann',
    'Byeong Hun An': 'Byeong Hun An',
    'Marc Leishman': 'Marc Leishman',
    'Jacob Skov Olesen': 'Jacob Skov Olesen',
    'Jon Rahm': 'Jon Rahm',
    'Ben Griffin': 'Ben Griffin',
    'Padraig Harrington': 'Padraig Harrington',
    'Maverick McNealy': 'Maverick McNealy',
    'Marco Penge': 'Marco Penge',
    'Nicolai Hojgaard': 'Nicolai Hojgaard',
    'Justin Rose': 'Justin Rose',
    'Cameron Smith': 'Cameron Smith',
    'Takumi Kanaya': 'Takumi Kanaya',
    'Tony Finau': 'Tony Finau',
    'Francesco Molinari': 'Francesco Molinari',
    'Bryson DeChambeau': 'Bryson DeChambeau',
    'Sergio Garcia': 'Sergio Garcia',
    'Mackenzie Hughes': 'Mackenzie Hughes',
    'Tommy Fleetwood': 'Tommy Fleetwood',
    'Jason Day': 'Jason Day',
    'Andrew Novak': 'Andrew Novak',
    'Antoine Rozner': 'Antoine Rozner',
    'Justin Hastings (a)': 'Justin Hastings',
    'Sam Burns': 'Sam Burns',
    'John Catlin': 'John Catlin',
    'Curtis Luck': 'Curtis Luck',
    'Phil Mickelson': 'Phil Mickelson',
    'Ryan Peake': 'Ryan Peake',
    'Rasmus Hojgaard': 'Rasmus Hojgaard',
    'Matthias Schmid': 'Matthias Schmid',
    'Young-han Song': 'Young-han Song',
    'Matteo Manassero': 'Matteo Manassero',
    'Max Greyserman': 'Max Greyserman',
    'Ludvig Aberg': 'Ludvig Aberg',
    'Ethan Fang (a)': 'Ethan Fang',
    'Robert MacIntyre': 'Robert MacIntyre',
    'Keegan Bradley': 'Keegan Bradley',
    'Matthew Jordan': 'Matthew Jordan',
    'Chris Gotterup': 'Chris Gotterup',
    'Taylor Pendrith': 'Taylor Pendrith',
    'Thriston Lawrence': 'Thriston Lawrence',
    'Ryggs Johnston': 'Ryggs Johnston',
    'Carlos Ortiz': 'Carlos Ortiz',
    'Denny McCarthy': 'Denny McCarthy',
    'Matt McCarty': 'Matt McCarty',
    'Daniel Berger': 'Daniel Berger',
    'Cameron Young': 'Cameron Young',
    'Jordan Smith': 'Jordan Smith',
    'K.J. Choi': 'KJ Choi',
    'Patrick Cantlay': 'Patrick Cantlay',
}

# Input picks data: (entrantName, picksName, [t1, t2, t3, t4, t5, t6])
# Golfer names normalized to remove accent marks for map lookup
PICKS = [
    ('Jacob D Hammer',  'Jacob D Hammer',       ['Rory McIlroy', 'Brooks Koepka', 'Wyndham Clark', 'Lucas Glover', 'Sahith Theegala', 'Connor Graham (a)']),
    ('Kyle Sheldon',    'Kyle Sheldon',          ['Rory McIlroy', 'Jordan Spieth', 'Rickie Fowler', 'Michael Kim', 'Zach Johnson', 'Darren Clarke']),
    ('Robert Stephenson','Robert Stephenson',    ['Shane Lowry', 'Brooks Koepka', 'Wyndham Clark', 'J.T. Poston', 'Matthieu Pavon', 'Julien Guerrier']),
    ('Robert Stephenson','Robert Stephenson 2',  ['Viktor Hovland', 'Jordan Spieth', 'Brian Harman', 'Thorbjorn Olesen', 'Brian Campbell', 'Sebastian Soderberg']),
    ('Nathan Wood',     'Nathan Wood',           ['Scottie Scheffler', 'Russell Henley', 'Sungjae Im', 'J.T. Poston', 'Jhonattan Vegas', 'Shaun Norris']),
    ('Bob Cross',       'Bob Cross',             ['Scottie Scheffler', 'Patrick Reed', 'Wyndham Clark', 'Akshay Bhatia', 'Jhonattan Vegas', 'Rikuya Hoshino']),
    ('Bob Cross',       'Bob Cross 2',           ['Viktor Hovland', 'Brooks Koepka', 'J.J. Spaun', 'Chris Kirk', 'Nico Echavarria', 'Oliver Lindell']),
    ('Ryne Stone',      'Ryne Stone',            ['Scottie Scheffler', 'Jordan Spieth', 'Si Woo Kim', 'Dean Burmester', 'Kristoffer Reitan', 'Sebastian Soderberg']),
    ('Cody Esbrandt',   'Cody Esbrandt',         ['Viktor Hovland', 'Joaquin Niemann', 'Brian Harman', 'Byeong Hun An', 'Marc Leishman', 'Jacob Skov Olesen']),
    ('Gregory J Smith', 'Gregory J Smith',       ['Jon Rahm', 'Ben Griffin', 'J.J. Spaun', 'Akshay Bhatia', 'Padraig Harrington', 'Jacob Skov Olesen']),
    ('Cassady Glenn',   'Cassady Glenn',         ['Scottie Scheffler', 'Jordan Spieth', 'Maverick McNealy', 'Marco Penge', 'Kristoffer Reitan', 'Sebastian Soderberg']),
    ('Myron Mayo',      'Myron Mayo',            ['Jon Rahm', 'Brooks Koepka', 'Rickie Fowler', 'Thorbjorn Olesen', 'Sahith Theegala', 'Darren Clarke']),
    ('Matthew Tuckfield','Matthew Tuckfield',    ['Scottie Scheffler', 'Sam Burns', 'Tom McKibbin', 'Marco Penge', 'John Catlin', 'Curtis Luck']),
    ('Nick Bova',       'Nick Bova',             ['Jon Rahm', 'Brooks Koepka', 'Nicolai Hojgaard', 'Akshay Bhatia', 'Jhonattan Vegas', 'Shaun Norris']),
    ('Chris Schumann',  'Chris Schumann',        ['Scottie Scheffler', 'Justin Rose', 'Cameron Smith', 'Thorbjorn Olesen', 'Sahith Theegala', 'Takumi Kanaya']),
    ('Paul Raymond',    'Paul Raymond',          ['Scottie Scheffler', 'Justin Rose', 'Tony Finau', 'Thorbjorn Olesen', 'Padraig Harrington', 'Francesco Molinari']),
    ('Erik Vermilyea',  'Erik Vermilyea',        ['Scottie Scheffler', 'Russell Henley', 'Brian Harman', 'Akshay Bhatia', 'Nico Echavarria', 'Ryggs Johnston']),
    ('Ron Pannullo',    'Ron Pannullo',          ['Bryson DeChambeau', 'Justin Rose', 'Maverick McNealy', 'Sergio Garcia', 'Mackenzie Hughes', 'Francesco Molinari']),
    ('Jeff Bagnasco',   'Jeff Bagnasco',         ['Tommy Fleetwood', 'Jason Day', 'J.J. Spaun', 'Andrew Novak', 'Antoine Rozner', 'Justin Hastings (a)']),
    ('Mitch Pletcher',  'Mitch Pletcher',        ['Scottie Scheffler', 'Patrick Reed', 'Cameron Smith', 'Michael Kim', 'Phil Mickelson', 'Ryan Peake']),
    ('Zach DelGandio',  'Zach DelGandio',        ['Rory McIlroy', 'Jordan Spieth', 'Maverick McNealy', 'Marco Penge', 'Padraig Harrington', 'Rikuya Hoshino']),
    ('Ethan DelGandio', 'Ethan DelGandio',       ['Rory McIlroy', 'Joaquin Niemann', 'Wyndham Clark', 'Akshay Bhatia', 'Padraig Harrington', 'K.J. Choi']),
    ('Morgan Coleman',  'Morgan Coleman',        ['Scottie Scheffler', 'Russell Henley', 'Daniel Berger', 'Denny McCarthy', 'Matt McCarty', 'Shaun Norris']),
    ('Luke S',          'Luke S',                ['Tommy Fleetwood', 'Cameron Young', 'Jordan Smith', 'Akshay Bhatia', 'Nico Echavarria', 'Francesco Molinari']),
    ('Jake Bogardus',   'Jake Bogardus',         ['Rory McIlroy', 'Justin Rose', 'Rasmus Hojgaard', 'Thorbjorn Olesen', 'Matthias Schmid', 'Francesco Molinari']),
    ('Matt Bova',       'Matt Bova',             ['Jon Rahm', 'Joaquin Niemann', 'Si Woo Kim', 'Carlos Ortiz', 'Matt McCarty', 'Shaun Norris']),
    ('Jacob D Hammer',  'Jake Hammer 2',         ['Bryson DeChambeau', 'Jordan Spieth', 'Cameron Smith', 'Lucas Glover', 'Brian Campbell', 'Young-han Song']),
    ('Ryne Stone',      'Ryne Stone 2',          ['Jon Rahm', 'Russell Henley', 'Nicolai Hojgaard', 'Marco Penge', 'Matteo Manassero', 'Sebastian Soderberg']),
    ('Jeffrey Mersch',  'Jeffrey Mersch',        ['Scottie Scheffler', 'Ben Griffin', 'Tom McKibbin', 'Max Greyserman', 'Antoine Rozner', 'Shaun Norris']),
    ('Matt Bova',       'Matt Bova 2',           ['Rory McIlroy', 'Patrick Cantlay', 'Wyndham Clark', 'Michael Kim', 'Mackenzie Hughes', 'Francesco Molinari']),
    ('Mike Davis',      'Mike Davis',            ['Ludvig Aberg', 'Justin Rose', 'Tony Finau', 'Akshay Bhatia', 'Kristoffer Reitan', 'Ethan Fang (a)']),
    ('Keith Waters',    'Keith Waters',          ['Jon Rahm', 'Sam Burns', 'J.J. Spaun', 'Max Greyserman', 'Matthieu Pavon', 'Justin Hastings (a)']),
    ('Sean Susa',       'Sean Susa',             ['Robert MacIntyre', 'Keegan Bradley', 'Si Woo Kim', 'Denny McCarthy', 'Matthew Jordan', 'Ethan Fang (a)']),
    ('Sean Susa',       'Sean Susa 2',           ['Rory McIlroy', 'Chris Gotterup', 'Taylor Pendrith', 'Thriston Lawrence', 'Sahith Theegala', 'Jacob Skov Olesen']),
]

# Display names (for JS output) - what actually goes in the golfer field
DISPLAY_NAMES = {
    'Scottie Scheffler': 'Scottie Scheffler',
    'Rory McIlroy': 'Rory McIlroy',
    'Brooks Koepka': 'Brooks Koepka',
    'Wyndham Clark': 'Wyndham Clark',
    'Lucas Glover': 'Lucas Glover',
    'Sahith Theegala': 'Sahith Theegala',
    'Connor Graham (a)': 'Connor Graham (a)',
    'Jordan Spieth': 'Jordan Spieth',
    'Rickie Fowler': 'Rickie Fowler',
    'Michael Kim': 'Michael Kim',
    'Zach Johnson': 'Zach Johnson',
    'Darren Clarke': 'Darren Clarke',
    'Shane Lowry': 'Shane Lowry',
    'J.T. Poston': 'J.T. Poston',
    'Matthieu Pavon': 'Matthieu Pavon',
    'Julien Guerrier': 'Julien Guerrier',
    'Viktor Hovland': 'Viktor Hovland',
    'Brian Harman': 'Brian Harman',
    'Thorbjorn Olesen': 'Thorbjorn Olesen',
    'Tom McKibbin': 'Tom McKibbin',
    'Brian Campbell': 'Brian Campbell',
    'Sebastian Soderberg': 'Sebastian Soderberg',
    'Russell Henley': 'Russell Henley',
    'Sungjae Im': 'Sungjae Im',
    'Jhonattan Vegas': 'Jhonattan Vegas',
    'Shaun Norris': 'Shaun Norris',
    'Patrick Reed': 'Patrick Reed',
    'Akshay Bhatia': 'Akshay Bhatia',
    'Rikuya Hoshino': 'Rikuya Hoshino',
    'J.J. Spaun': 'J.J. Spaun',
    'Chris Kirk': 'Chris Kirk',
    'Nico Echavarria': 'Nico Echavarria',
    'Oliver Lindell': 'Oliver Lindell',
    'Si Woo Kim': 'Si Woo Kim',
    'Dean Burmester': 'Dean Burmester',
    'Kristoffer Reitan': 'Kristoffer Reitan',
    'Joaquin Niemann': 'Joaquin Niemann',
    'Byeong Hun An': 'Byeong Hun An',
    'Marc Leishman': 'Marc Leishman',
    'Jacob Skov Olesen': 'Jacob Skov Olesen',
    'Jon Rahm': 'Jon Rahm',
    'Ben Griffin': 'Ben Griffin',
    'Padraig Harrington': 'Padraig Harrington',
    'Maverick McNealy': 'Maverick McNealy',
    'Marco Penge': 'Marco Penge',
    'Nicolai Hojgaard': 'Nicolai Hojgaard',
    'Justin Rose': 'Justin Rose',
    'Cameron Smith': 'Cameron Smith',
    'Takumi Kanaya': 'Takumi Kanaya',
    'Tony Finau': 'Tony Finau',
    'Francesco Molinari': 'Francesco Molinari',
    'Bryson DeChambeau': 'Bryson DeChambeau',
    'Sergio Garcia': 'Sergio Garcia',
    'Mackenzie Hughes': 'Mackenzie Hughes',
    'Tommy Fleetwood': 'Tommy Fleetwood',
    'Jason Day': 'Jason Day',
    'Andrew Novak': 'Andrew Novak',
    'Antoine Rozner': 'Antoine Rozner',
    'Justin Hastings (a)': 'Justin Hastings (a)',
    'Sam Burns': 'Sam Burns',
    'John Catlin': 'John Catlin',
    'Curtis Luck': 'Curtis Luck',
    'Phil Mickelson': 'Phil Mickelson',
    'Ryan Peake': 'Ryan Peake',
    'Rasmus Hojgaard': 'Rasmus Hojgaard',
    'Matthias Schmid': 'Matthias Schmid',
    'Young-han Song': 'Young-han Song',
    'Matteo Manassero': 'Matteo Manassero',
    'Max Greyserman': 'Max Greyserman',
    'Ludvig Aberg': 'Ludvig Aberg',
    'Ethan Fang (a)': 'Ethan Fang (a)',
    'Robert MacIntyre': 'Robert MacIntyre',
    'Keegan Bradley': 'Keegan Bradley',
    'Matthew Jordan': 'Matthew Jordan',
    'Chris Gotterup': 'Chris Gotterup',
    'Taylor Pendrith': 'Taylor Pendrith',
    'Thriston Lawrence': 'Thriston Lawrence',
    'Ryggs Johnston': 'Ryggs Johnston',
    'Carlos Ortiz': 'Carlos Ortiz',
    'Denny McCarthy': 'Denny McCarthy',
    'Matt McCarty': 'Matt McCarty',
    'Daniel Berger': 'Daniel Berger',
    'Cameron Young': 'Cameron Young',
    'Jordan Smith': 'Jordan Smith',
    'K.J. Choi': 'K.J. Choi',
    'Patrick Cantlay': 'Patrick Cantlay',
}


def get_score(pick_name, rnd):
    """Get the field score for a golfer in a given round (total, r1, r2, r3, r4)."""
    key = NAME_MAP.get(pick_name)
    if key is None:
        raise ValueError(f'No field entry for pick name: {pick_name!r}')
    g = FIELD[key]
    if rnd == 'total':
        # Sum r1+r2+r3+r4 (r3/r4 already = 10 for MC players)
        return g['r1'] + g['r2'] + g['r3'] + g['r4']
    return g[rnd]


def best4_of_6(scores):
    """Return (total_of_best4, list_of_booleans is_top4_per_slot)."""
    indexed = sorted(enumerate(scores), key=lambda x: x[1])
    top4_idx = {i for i, _ in indexed[:4]}
    total = sum(s for i, s in enumerate(scores) if i in top4_idx)
    is_top4 = [i in top4_idx for i in range(6)]
    return total, is_top4


def calc_entry(entrant, picks_name, golfers, rnd):
    """Return a dict with rank, total, pick, tierScores for a given round."""
    scores = [get_score(g, rnd) for g in golfers]
    total, is_top4 = best4_of_6(scores)
    tier_scores = {}
    for i, (g, sc, top4) in enumerate(zip(golfers, scores, is_top4), 1):
        display = DISPLAY_NAMES.get(g, g)
        tier_scores[f't{i}'] = {'score': sc, 'status': None, 'golfer': display, 'isTop4': top4}
    return {
        'entrantName': entrant,
        'picksName': picks_name,
        'golfers': golfers,
        'total': total,
        'tierScores': tier_scores,
    }


def assign_ranks(entries):
    """Sort by total, assign ranks (ties get same rank)."""
    entries.sort(key=lambda e: e['total'])
    rank = 1
    for i, e in enumerate(entries):
        if i > 0 and e['total'] == entries[i-1]['total']:
            e['rank'] = entries[i-1]['rank']
        else:
            e['rank'] = rank
        rank = i + 2
    return entries


def fmt_entry(e):
    """Format one entry as a JS object literal (single line)."""
    def fmt_tier(t):
        score = t['score']
        status = 'null' if t['status'] is None else f"'{t['status']}'"
        golfer = t['golfer'].replace("'", "\\'")
        top4 = 'true' if t['isTop4'] else 'false'
        return f"{{ score: {score}, status: {status}, golfer: '{golfer}', isTop4: {top4} }}"

    tiers = ', '.join(f"t{i}: {fmt_tier(e['tierScores'][f't{i}'])}" for i in range(1, 7))
    entrant = e['entrantName'].replace("'", "\\'")
    picks = e['picksName'].replace("'", "\\'")
    return (f"  {{ rank: {e['rank']}, total: {e['total']}, "
            f"pick: {{ entrantName: '{entrant}', picksName: '{picks}' }}, "
            f"tierScores: {{ {tiers} }} }},")


def print_constant(name, entries):
    print(f'const {name} = [')
    for e in entries:
        print(fmt_entry(e))
    print('];')
    print()


# ---- Calculate standings ----

rounds = ['total', 'r1', 'r2', 'r3', 'r4']
suffix = ['TOTAL', 'R1', 'R2', 'R3', 'R4']

for rnd, suf in zip(rounds, suffix):
    entries = [calc_entry(en, pn, gs, rnd) for en, pn, gs in PICKS]
    entries = assign_ranks(entries)
    print_constant(f'THEOPEN_2025_{suf}', entries)
