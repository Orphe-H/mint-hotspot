/**
 * fmtDur / devicesText : formatage pur (durée, tableau monospace).
 */

'use strict';

const { loadExtension } = require('./load-extension');

describe('fmtDur', () => {
    let fmtDur;

    beforeAll(() => {
        ({ fmtDur } = loadExtension());
    });

    test.each([
        [0, '0s'],
        [undefined, '0s'],
        [null, '0s'],
        ['abc', '0s'],
        [9, '9s'],
        [59, '59s'],
        [60, '1m'],
        [119, '1m'],
        [2700, '45m'],
        [3599, '59m'],
        [3600, '1h00m'],
        [3900, '1h05m'],
        [11520, '3h12m'],
        [-5, '0s'],
        [59.9, '59s'], // floor
    ])('fmtDur(%p) === %p', (input, expected) => {
        expect(fmtDur(input)).toBe(expected);
    });
});

describe('devicesText', () => {
    let devicesText;

    beforeAll(() => {
        ({ devicesText } = loadExtension());
    });

    test('liste vide → message', () => {
        expect(devicesText([])).toBe('Aucun appareil connecté.');
    });

    test('en-tête de colonnes Nom/IP/Durée/MAC/Fabricant', () => {
        const text = devicesText([]);
        // En-tête présent même vide ? non : message seul. Avec un appareil :
        const one = devicesText([{ ip: '1.2.3.4', mac: 'aa:bb:cc:dd:ee:ff', seconds: 65, hostname: 'h', vendor: 'V' }]);
        expect(one.split('\n')[0]).toContain('Nom');
        expect(one.split('\n')[0]).toContain('IP');
        expect(one.split('\n')[0]).toContain('Durée');
        expect(one.split('\n')[0]).toContain('MAC');
        expect(one.split('\n')[0]).toContain('Fabricant');
        expect(text).toBe('Aucun appareil connecté.');
    });

    test('une ligne par appareil, champs manquants → -', () => {
        const lines = devicesText([
            { ip: '192.168.1.10', mac: 'aa:bb:cc:11:22:33', seconds: 11520, hostname: 'smartphone', vendor: 'Apple' },
            { ip: '', mac: '', seconds: 0, hostname: '', vendor: '' },
        ]).split('\n');
        expect(lines).toHaveLength(3);
        expect(lines[1]).toContain('smartphone');
        expect(lines[1]).toContain('192.168.1.10');
        expect(lines[1]).toContain('3h12m');
        expect(lines[2]).toContain('-');
    });

    test('hostname et vendor tronqués (24 et 28)', () => {
        const long = 'x'.repeat(50);
        const line = devicesText([{ ip: '1.1.1.1', mac: 'aa', seconds: 1, hostname: long, vendor: long }])
            .split('\n')[1];
        // hostname tronqué à 24 + vendor tronqué à 28 → 52 x au total (pas 100).
        expect(line.match(/x/g).length).toBe(52);
    });

    test('seconds non numériques → 0s', () => {
        const line = devicesText([{ ip: '1.1.1.1', mac: 'aa', seconds: 'zz', hostname: 'h', vendor: 'v' }])
            .split('\n')[1];
        expect(line).toContain('0s');
    });
});
