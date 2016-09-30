define([
	"dojo/_base/declare", "dojo/_base/lang", "dojo/_base/Deferred",
	"dojo/request", "dojo/on", "dojo/store/Memory",
	"dojo/query", "dojo/dom-class", "dojo/dom-construct",
	"dijit/_WidgetBase", "dijit/_TemplatedMixin", "dijit/_WidgetsInTemplateMixin",
	"dojo/text!./templates/BLAST.html", "dijit/form/Form",
	"dojox/widget/Standby",
	"../GridContainer", "../Grid", "../GridSelector", "../../util/PathJoin", "../../WorkspaceManager"
], function(declare, lang, Deferred,
			xhr, on, Memory,
			query, domClass, domConstruct,
			WidgetBase, Templated, WidgetsInTemplate,
			Template, FormMixin,
			Standby,
			GridContainer, Grid, selector, PathJoin, WorkspaceManager){

	const NA = "nucleotide", AA = "protein";

	const ProgramDefs = [
		{
			value: "blastn",
			label: "blastn - search a nucleotide database using a nucleotide query",
			validDatabase: ['.fna', '.ffn', '.frn', 'selGenome', 'selGroup', 'selTaxon'],
			validQuery: [NA]
		},
		{
			value: "blastp",
			label: "blastp - search protein database using a protein query",
			validDatabase: ['faa', 'selGenome', 'selGroup', 'selTaxon'],
			validQuery: [AA]
		},
		{
			value: "blastx",
			label: "blastx - search protein database using a translated nucleotide query",
			validDatabase: ['faa', 'selGenome', 'selGroup', 'selTaxon'],
			validQuery: [NA]
		},
		{
			value: "tblastn",
			label: "tblastn - search translated nucleotide database using a protein query",
			validDatabase: ['fna', 'ffn', 'selGenome', 'selGroup', 'selTaxon'],
			validQuery: [AA]
		},
		{
			value: "tblastx",
			label: "tblastx - search translated nucleotide database using a translated nucleotide query",
			validDatabase: ['fna', 'ffn', 'selGenome', 'selGroup', 'selTaxon'],
			validQuery: [NA]
		}
	];

	const DatabaseDefs = [
		{value: "ref.fna", label: "Reference or Representative Genomes (fna)"},
		{value: "ref.ffn", label: "Reference or Representative Genome features (ffn)"},
		{value: "ref.faa", label: "Reference or Representative Genome proteins (faa)"},
		{value: "ref.frn", label: "Reference or Representative Genome RNAs features (frn)"},
		{value: "transcriptomics.fna", label: "Transcriptomics Genomes (fna)"},
		{value: "transcriptomics.ffn", label: "Transcriptomics Genomes features (ffn)"},
		{value: "plasmid.fna", label: "plasmid contigs (fna)"},
		{value: "plasmid.ffn", label: "plasmid contigs features (ffn)"},
		{value: "plasmid.faa", label: "plasmid contigs proteins (faa)"},
		{value: "spgenes.faa", label: "Specialty gene reference proteins (faa)"},
		{value: "selGenome", label: "Search within selected genomes"},
		{value: "selGroup", label: "Search within selected genome group"},
		{value: "selTaxon", label: "Search within selected taxon"}
	];

	return declare([WidgetBase, FormMixin, Templated, WidgetsInTemplate], {
		"baseClass": "BLAST",
		templateString: Template,
		addedGenomes: 0,
		maxGenomes: 20,
		startingRows: 5,
		loadingMask: null,
		result_store: null,
		result_grid: null,
		constructor: function(){
			this.genomeToAttachPt = ["genome_id"];
		},

		startup: function(){
			this.emptyTable(this.genomeTable, this.startingRows);

			on(this.advanced, 'click', lang.hitch(this, function(){
				this.toggleAdvanced((this.advancedOptions.style.display == 'none'));
			}));

			this.buildResultContainer();
		},
		toggleAdvanced: function(flag){
			if(flag){
				this.advancedOptions.style.display = 'block';
				this.advancedOptionIcon.className = "fa icon-caret-left fa-1";
			}
			else{
				this.advancedOptions.style.display = 'none';
				this.advancedOptionIcon.className = "fa icon-caret-down fa-1";
			}
		},

		hasSingleFastaSequence: function(sequence){
			return sequence.indexOf('>') > -1 && (sequence.indexOf('>') == sequence.lastIndexOf('>'));
		},

		isNucleotideFastaSequence: function(sequence){
			var patternFastaHeader = /^>.*\n/gi;
			var patternDnaSequence = /[atcgn\n\s]/gi;

			return (sequence.replace(patternFastaHeader, '').replace(patternDnaSequence, '').length === 0);
		},

		validate: function(){
			// console.log("validate", this.sequence.get('value'), (this.sequence.get('value')).length,  this.database.get('value'), this.program.get('value'));

			var sequence = this.sequence.get('value');

			if(sequence && sequence.length > 1
				&& this.database.get('value')
				&& this.program.get('value')
				&& this.hasSingleFastaSequence(sequence)){

				// console.log("validation passed");
				this.mapButton.set('disabled', false);
				return true;
			}else{
				this.mapButton.set('disabled', true);
				return false;
			}
		},

		submit: function(){
			var _self = this;
			var sequence = this.sequence.get('value');
			var database = this.database.get('value');
			var useDatabase = !(["selGenome", "selGroup", "selTaxon"].indexOf(database) > -1);
			var program = this.program.get('value');
			var evalue = this.evalue.get('value');
			var max_hits = parseInt(this.max_hits.get('value'));
			var method, params;
			var def = new Deferred();

			if(useDatabase){
				def.resolve();
				method = "HomologyService.blast_fasta_to_database";
				params = [encodeURIComponent(sequence), program, database, evalue, max_hits, 0];
			}else{
				// blast against genomes/groups/taxon
				var genomeIds = [];
				switch(database){
					case "selGenome":
						query(".genomedata").forEach(function(item){
							genomeIds.push(item.genomeRecord.genome_id);
						});
						if(genomeIds.length == 0){
							this.genome_id_message.innerHTML = 'No genome has selected. Please use arrow button to collect genomes to search.';
							return;
						}else{
							this.genome_id_message.innerHTML = '';
						}
						def.resolve(genomeIds);
						break;
					case "selGroup":
						var path = this.genome_group.get('value');

						WorkspaceManager.getObjects(path, false).then(lang.hitch(this, function(objs){

							var genomeIdHash = {};
							objs.forEach(function(obj){
								var data = JSON.parse(obj.data);
								data.id_list.genome_id.forEach(function(d){
									if(!genomeIdHash.hasOwnProperty(d)){
										genomeIdHash[d] = true;
									}
								})
							});
							var genomeIds = Object.keys(genomeIdHash);
							def.resolve(genomeIds);
						}));
						break;
					case "selTaxon":
						break;
					default:
						break;
				}

				var search_for = this.search_for.get('value');
				method = "HomologyService.blast_fasta_to_genomes";
				params = [encodeURIComponent(sequence), program, [], search_for, evalue, max_hits, 0];
			}

			var q = {
				params: params,
				method: method,
				version: "1.1",
				id: String(Math.random()).slice(2)
			};

			_self.loadingMask.show();
			query(".blast_result .GridContainer").style("visibility", "visible");
			domClass.add(query(".blast_form")[0], "hidden");
			query(".reSubmitBtn").style("visibility", "visible");

			// var data = this.formatJSONResult(this.test_result());
			// this.updateResult(data);
			// return;

			def.promise.then(function(genomeIds){

				if(!useDatabase){
					// console.log("updated genomeIds: ", genomeIds);
					q.params[2] = genomeIds;
				}

				// console.log(q);

				xhr.post("https://p3.theseed.org/services/homology_service", {
					headers: {
						"Accept": "application/json"
					},
					handleAs: "json",
					data: JSON.stringify(q)
				}).then(function(res){

					var patricIds = Object.keys(res['result'][1]);

					xhr.post(window.App.dataAPI + 'genome_feature/', {
						handleAs: 'json',
						headers: {
							'Accept': "application/json",
							'Content-Type': "application/solrquery+x-www-form-urlencoded",
							'X-Requested-With': null,
							'Authorization': (window.App.authorizationToken || "")
						},
						data: {
							q: "patric_id:(" + patricIds.join(' OR ') + ")"
						}
					}).then(function(features){

						var featureMap = {};
						features.forEach(function(f){
							featureMap[f.patric_id] = f;
						});

						res['result'][3] = featureMap;

						// console.log(res);
						var data = _self.formatJSONResult(res);
						_self.updateResult(data);
					});

				}, function(err){
					_self.buildErrorMessage(err);
				})
			});

		},

		resubmit: function(){
			domClass.remove(query(".blast_form")[0], "hidden");
			query(".reSubmitBtn").style("visibility", "hidden");
		},

		buildErrorMessage: function(err){
			query(".blast_result")[0].innerHTML = err.response.data;
		},

		buildResultContainer: function(){

			var self = this;

			// TODO: need to change container type and primary id based on the database (and search_for)

			// build store
			this.result_store = new (declare([Memory]))({
				data: [],
				idProperty: "feature_id",
				queryOptions: {
					sort: [{attribute: "pident", descending: true}]
				}
			});

			// build grid
			var BLASTGrid = declare([Grid], {
				region: "center",
				selectionModel: "extended",
				dataModel: "genome_feature",
				store: this.result_store,
				columns: {
					"Selection Checkboxes": selector({label: '', sortable: false, unhidable: true}),
					expand: {
						label: '', field: '', sortable: false, unhidable: true, renderCell: function(obj, val, node){
							node.innerHTML = '<div class="dgrid-expando-icon ui-icon ui-icon-triangle-1-e"></div>';
						}
					},
					product: {label: 'Product', field: "function"},
					genome: {label: 'Genome', field: "genome_name"},
					identity: {
						label: 'Identity', field: "pident", formatter: function(val){
							return val + '%'
						}
					},
					q_coverage: {
						label: 'Query cover', field: "query_coverage", formatter: function(val){
							return val + '%'
						}
					},
					s_coverage: {
						label: 'Subject cover', field: "subject_coverage", formatter: function(val){
							return val + '%'
						}
					},
					length: {label: 'Length', field: "length"},
					score: {label: 'Score', field: 'bitscore'},
					evalue: {label: 'E value', field: 'evalue'}
				},
				renderRow: function(obj){
					var div = domConstruct.create('div', {className: 'collapsed'});
					div.appendChild(Grid.prototype.renderRow.apply(this, arguments));
					var subDiv = domConstruct.create('div', {className: 'detail'}, div);
					subDiv.appendChild(self.buildDetailView(obj.detail));
					return div;
				},
				startup: function(){
					var self = this;

					this.on(".dgrid-cell div.dgrid-expando-icon:click", function(evt){

						var node = self.row(evt).element;
						var target = evt.target || evt.srcElement;
						var collapsed = domClass.contains(node, 'collapsed');
						// console.log(evt, node);

						domClass.toggle(node, 'collapsed', !collapsed);
						domClass.toggle(target, 'ui-icon-triangle-1-e', !collapsed);
						domClass.toggle(target, 'ui-icon-triangle-1-se', collapsed);
					});

					this.on("dgrid-select", function(evt){
						var newEvt = {
							rows: evt.rows,
							selected: evt.grid.selection,
							grid: self,
							bubbles: true,
							cancelable: true
						};
						on.emit(self.domNode, "select", newEvt);
					});

					this.on("dgrid-deselect", function(evt){
						var newEvt = {
							rows: evt.rows,
							selected: evt.grid.selection,
							grid: self,
							bubbles: true,
							cancelable: true
						};
						on.emit(self.domNode, "deselect", newEvt);
					});

					this.inherited(arguments);
				}
			});

			var BLASTGridContainer = declare([GridContainer], {
				gridCtor: BLASTGrid,
				containerType: "feature_data",
				enableFilterPanel: false,
				visible: true,
				buildQuery: function(){
					// console.log("buildQuery");
					return {};
				}
			});

			this.result_grid = new BLASTGridContainer({
				style: "min-height: 500px; visibility:hidden;"
			}).placeAt(query(".blast_result")[0]);
			this.result_grid.startup();

			this.loadingMask = new Standby({
				target: this.id,
				image: "/public/js/p3/resources/images/ring-alt.svg",
				color: "#efefef"
			});
			this.result_grid.addChild(this.loadingMask);
			this.loadingMask.startup();

			// console.log(this.result_grid);
		},

		updateResult(data){
			this.result_store.setData(data);
			this.result_grid.grid.refresh();
			this.loadingMask.hide();
		},

		formatEvalue: function(evalue){
			if(evalue.toString().includes('e')){
				var val = evalue.toString().split('e');
				return parseInt(val[0]) + 'e' + val[1];
			}else if(evalue !== 0){
				return evalue.toFixed(4);
			}else{
				return evalue;
			}
		},

		formatJSONResult: function(json){
			// console.log(json);

			var report = json['result'][0][0].report;
			var search = report.results.search;
			var hits = search.hits;
			var query_id = search.query_id;
			var query_length = search.query_len;
			var metadata = json['result'][1];
			var identical = json['result'][2] || {};
			var features = json['result'][3] || {};

			var entries = [];
			hits.forEach(function(hit){
				var target_id = hit.description[0].id;
				var entry = {
					"feature_id": features[target_id].feature_id || target_id,
					"qseqid": query_id,
					"sseqid": target_id,
					"pident": Math.round(hit.hsps[0].identity / hit.hsps[0].align_len * 100),
					"query_coverage": Math.round((Math.abs(hit.hsps[0].query_to - hit.hsps[0].query_from) + 1) / query_length * 100),
					"subject_coverage": Math.round((Math.abs(hit.hsps[0].hit_to - hit.hsps[0].hit_from) + 1) / hit.len * 100),
					"length": hit.len,
					"evalue": this.formatEvalue(hit.hsps[0]['evalue']),
					"bitscore": Math.round(hit.hsps[0]['bit_score']),
					"genome_id": metadata[target_id].genome_id,
					"genome_name": metadata[target_id].genome_name,
					"function": metadata[target_id].function,
					"detail": {
						"match_count": metadata[target_id].match_count || 0,
						"matches": identical[target_id] || [],
						"hsps": hit.hsps,
						"query_len": query_length,
						"subject_len": hit.len
					}
				};
				if(features[target_id]){
					entry = lang.mixin(entry, features[target_id]);
				}
				entries.push(entry);
			}, this);
			return entries;
		},

		onSuggestNameChange: function(){
			// console.log("onSuggestNameChange");
			// TODO: implement
			this.validate();
		},

		onAddGenome: function(){

			var lrec = {};
			var chkPassed = this.ingestAttachPoints(this.genomeToAttachPt, lrec);

			if(chkPassed && this.addedGenomes < this.maxGenomes){
				var tr = this.genomeTable.insertRow(0);
				var td = domConstruct.create('td', {"class": "textcol genomedata", innerHTML: ""}, tr);
				td.genomeRecord = lrec;
				td.innerHTML = "<div class='libraryrow'>" + this.makeGenomeName() + "</div>";
				var tdinfo = domConstruct.create("td", {innerHTML: ""}, tr);
				var td2 = domConstruct.create("td", {innerHTML: "<i class='fa icon-x fa-1x' />"}, tr);
				if(this.addedGenomes < this.startingRows){
					this.genomeTable.deleteRow(-1);
				}
				var handle = on(td2, "click", lang.hitch(this, function(evt){
					domConstruct.destroy(tr);
					this.decreaseGenome();
					if(this.addedGenomes < this.startingRows){
						var ntr = this.genomeTable.insertRow(-1);
						domConstruct.create('td', {innerHTML: "<div class='emptyrow'></div>"}, ntr);
						domConstruct.create("td", {innerHTML: "<div class='emptyrow'></div>"}, ntr);
						domConstruct.create("td", {innerHTML: "<div class='emptyrow'></div>"}, ntr);
					}
					handle.remove();
				}));
				this.increaseGenome();
			}
		},

		ingestAttachPoints: function(input_pts, target, req){
			req = typeof req !== 'undefined' ? req : true;
			var success = 1;
			input_pts.forEach(function(attachname){
				var incomplete = 0;
				var browser_select = 0;

				var compGenomeList = query(".genomedata");
				var genomeIds = [];

				compGenomeList.forEach(function(item){
					genomeIds.push(item.genomeRecord.genome_id)
				});

				var cur_value = this[attachname].value;

				//console.log("genomeIds = " + genomeIds + " cur_value = " + cur_value + " index = " +genomeIds.indexOf(cur_value));
				if(genomeIds.length > 0 && genomeIds.indexOf(cur_value) > -1)  // no same genome ids are allowed
				{
					success = 0;
				}

				if(typeof(cur_value) == "string"){
					target[attachname] = cur_value.trim();
				}
				else{
					target[attachname] = cur_value;
				}
				if(req && (!target[attachname] || incomplete)){
					if(browser_select){
						this[attachname].searchBox.validate(); //this should be whats done but it doesn't actually call the new validator
						this[attachname].searchBox._set("state", "Error");
						this[attachname].focus = true;
					}
					success = 0;
				}
				else{
					this[attachname]._set("state", "");
				}
				if(target[attachname] != ""){
					target[attachname] = target[attachname] || undefined;
				}
				else if(target[attachname] == "true"){
					target[attachname] = true;
				}
				else if(target[attachname] == "false"){
					target[attachname] = false;
				}
			}, this);
			return (success);
		},

		makeGenomeName: function(){
			var name = this.genome_id.get("displayedValue");
			var maxName = 50;
			var display_name = name;
			if(name.length > maxName){
				display_name = name.substr(0, (maxName / 2) - 2) + "...." + name.substr((name.length - (maxName / 2)) + 2);
			}

			return display_name;
		},

		increaseGenome: function(){
			this.addedGenomes = this.addedGenomes + 1;
		},

		decreaseGenome: function(){
			this.addedGenomes = this.addedGenomes - 1;
		},

		emptyTable: function(target, rowLimit){
			for(var i = 0; i < rowLimit; i++){
				var tr = target.insertRow(0);
				domConstruct.create("td", {innerHTML: "<div class='emptyrow'></div>"}, tr);
				domConstruct.create("td", {innerHTML: "<div class='emptyrow'></div>"}, tr);
				domConstruct.create("td", {innerHTML: "<div class='emptyrow'></div>"}, tr);
			}
		},

		onChangeSequence: function(val){
			// console.log("onChangeSequence: [", val, "]");
			if(!val){
				this.sequence_message.innerHTML = 'Please provide query sequence.';
				return;
			}
			if(!this.hasSingleFastaSequence(val)){
				this.sequence_message.innerHTML = 'please provide only one nucleotide or protein sequence';
				return;
			}
			this.sequence_message.innerHTML = '';
			this.program.set('disabled', false);

			var sequence_type = this.isNucleotideFastaSequence(val) ? NA : AA;
			this.program.removeOption(ProgramDefs);
			this.program.addOption(ProgramDefs.filter(function(p){
				return p.validQuery.indexOf(sequence_type) > -1
			}));
			this.program.loadAndOpenDropDown();
		},

		onChangeProgram: function(val){
			// console.log("onChangeProgram: [", val, "]");

			this.database.set('disabled', false);

			var validDatabaseTypes = ProgramDefs.find(function(p){
				return p.value === val
			}).validDatabase;

			// console.log(validDatabaseTypes);
			this.database.removeOption(DatabaseDefs);
			this.database.addOption(DatabaseDefs.filter(function(d){
				return validDatabaseTypes.some(function(t){
					return (d.value).match(t);
				})
			}));

			this.validate();
		},

		onChangeDatabase: function(val){
			if(["selGenome", "selGroup", "selTaxon"].indexOf(val) > -1){
				// show advance options
				this.toggleAdvanced(true);

				this.search_for.set('disabled', false);

				switch(val){
					case "selGenome":
						this.genome_id.set('disabled', false);
						this.genome_group.set('disabled', true);
						this.taxonomy.set('disabled', true);
						break;
					case "selGroup":
						if(!window.App.user){
							this.database_message.innerHTML = "Please login first to use genome group selection";
							return;
						}

						this.genome_id.set('disabled', true);
						this.genome_group.set('disabled', false);
						this.taxonomy.set('disabled', true);
						break;
					case "selTaxon":
						this.genome_id.set('disabled', true);
						this.genome_group.set('disabled', true);
						this.taxonomy.set('disabled', false);
						break;
					default:
						break;
				}
			}else{
				this.toggleAdvanced(false);

				this.search_for.set('disabled', true);
				this.genome_id.set('disabled', true);
				this.genome_group.set('disabled', true);
				this.taxonomy.set('disabled', true);
			}

			this.validate();
		},

		buildDetailView: function(detail){
			var outputDiv = [];

			detail.hsps.forEach(function(hsp){
				var output = [];
				var qSeqArr = hsp['qseq'].match(/.{1,60}/g);
				var hSeqArr = hsp['hseq'].match(/.{1,60}/g);
				var mlArr = hsp['midline'].match(/.{1,60}/g);

				// header
				output.push([
					'Query length: ' + detail.query_len,
					'Subject length: ' + detail.subject_len
				].join('    '));
				output.push([
					'Score: ' + Math.round(hsp.bit_score) + ' bits(' + hsp.score + ')',
					'Expect: ' + this.formatEvalue(hsp.evalue),
					hsp.hit_strand ? 'Strand: ' + hsp.query_strand + '/' + hsp.hit_strand : ''
				].join('    '));
				output.push([
					'Identities: ' + hsp.identity + '/' + hsp.align_len + '(' + Math.round(hsp.identity / hsp.align_len * 100) + '%)',
					hsp.positive ? 'Positives: ' + hsp.positive + '/' + hsp.align_len + '(' + Math.round(hsp.positive / hsp.align_len * 100) + '%)' : '',
					'Gaps: ' + hsp.gaps + '/' + hsp.align_len + '(' + Math.round(hsp.gaps / hsp.align_len * 100) + '%)',
					(hsp.query_frame || hsp.hit_frame) ? ('Frame: ' + (hsp.query_frame ? hsp.query_frame : '')
					+ ((hsp.query_frame && hsp.hit_frame) ? '/' : '')
					+ (hsp.hit_frame ? hsp.hit_frame : '')) : ''
				].join('    '));
				output.push('\n');

				var query_pos = hsp.query_from;
				var hit_pos = hsp.hit_from;
				for(var i = 0, n = qSeqArr.length; i < n; i++){
					var query_from = String('        ' + query_pos).slice(-8);
					var hit_from = String('        ' + hit_pos).slice(-8);

					var query_to, hit_to;
					if(hsp.query_strand == undefined || hsp.query_strand === 'Plus'){
						query_to = query_pos + qSeqArr[i].match(/[A-Z]/gi).length - 1;
						query_pos = query_to + 1;
					}else{
						query_to = query_pos - qSeqArr[i].match(/[A-Z]/gi).length + 1;
						query_pos = query_to - 1;
					}
					if(hsp.hit_strand == undefined || hsp.hit_strand === 'Plus'){
						hit_to = hit_pos + hSeqArr[i].match(/[A-Z]/gi).length - 1;
						hit_pos = hit_to + 1;
					}else{
						hit_to = hit_pos - hSeqArr[i].match(/[A-Z]/gi).length + 1;
						hit_pos = hit_to - 1;
					}

					output.push(['Query', query_from, qSeqArr[i], query_to].join('  '));
					output.push(['     ', '        ', mlArr[i], '    '].join('  '));
					output.push(['Sbjct', hit_from, hSeqArr[i], hit_to].join('  '));
					output.push('\n');
				}
				outputDiv.push('<pre>' + output.join('\n') + '</pre>');
			}, this);

			return domConstruct.toDom('<div class="align">' + outputDiv.join('<br/>') + '</div>');
		},

		test_result: function(){
			var r = '{"result":[[{"report":{"params":{"filter":"L;m;","gap_extend":0,"gap_open":0,"sc_match":1,"sc_mismatch":-2,"expect":10},"program":"blastn","reference":"Zheng Zhang, Scott Schwartz, Lukas Wagner, and Webb Miller (2000), A greedy algorithm for aligning DNA sequences, J Comput Biol 2000; 7(1-2):203-14.","version":"BLASTN 2.3.0+","search_target":{"db":"/tmp/jQOG0oo9Tp"},"results":{"search":{"stat":{"kappa":0.46,"entropy":0.85,"lambda":1.28,"eff_space":76986597324,"hsp_len":26,"db_num":328432,"db_len":290541420},"query_len":299,"hits":[{"len":1119,"description":[{"title":"fig|83332.12.peg.1009|Rv0906|VBIMycTub87468_1009|   Outer membrane protein romA   [Mycobacterium tuberculosis H37Rv | 83332.12]","accession":"312432","id":"fig|83332.12.peg.1009"}],"num":1,"hsps":[{"hit_to":240,"num":1,"query_from":57,"identity":240,"qseq":"ATGGTGCGCCGAGCGCTACGACTGGCGGCCGGCACCGCCTCGCTGGCCGCCGGCACGTGGACTGTTGCGTGCGCTGCACGGCACGCCGGCCGCGCTCGGTGCCGACGCGGCGTCGATCAGGAGCTGTGTCGGAGCAATCGCCGAACTATCGTGACGGCGCCTTCGTCAACCTGGATCCCGCGATCGATGTTCACCCTGGATCGCGAGGAGCTTCGGCTCATCGTGTGGGAGTTAGTGGCCAGA","query_to":299,"align_len":243,"midline":"|||||||||||||||||||||||||||||||||||||||||||||||||||||||||||| |||||||||||||||||||||||||||||||||||||||||||||||||||||||||||| |||||||||||||||||||||||||||||||||||||||||||||||||||||||||||| ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||","bit_score":429.543,"query_strand":"Plus","evalue":3.81139e-119,"hit_from":1,"gaps":3,"hseq":"ATGGTGCGCCGAGCGCTACGACTGGCGGCCGGCACCGCCTCGCTGGCCGCCGGCACGTGG-CTGTTGCGTGCGCTGCACGGCACGCCGGCCGCGCTCGGTGCCGACGCGGCGTCGATCAGG-GCTGTGTCGGAGCAATCGCCGAACTATCGTGACGGCGCCTTCGTCAACCTGGATCCCGCG-TCGATGTTCACCCTGGATCGCGAGGAGCTTCGGCTCATCGTGTGGGAGTTAGTGGCCAGA","hit_strand":"Plus","score":232}]},{"hsps":[{"align_len":243,"bit_score":429.543,"midline":"|||||||||||||||||||||||||||||||||||||||||||||||||||||||||||| |||||||||||||||||||||||||||||||||||||||||||||||||||||||||||| |||||||||||||||||||||||||||||||||||||||||||||||||||||||||||| ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||","query_strand":"Plus","hit_from":1,"gaps":3,"evalue":3.81139e-119,"hit_strand":"Plus","score":232,"hseq":"ATGGTGCGCCGAGCGCTACGACTGGCGGCCGGCACCGCCTCGCTGGCCGCCGGCACGTGG-CTGTTGCGTGCGCTGCACGGCACGCCGGCCGCGCTCGGTGCCGACGCGGCGTCGATCAGG-GCTGTGTCGGAGCAATCGCCGAACTATCGTGACGGCGCCTTCGTCAACCTGGATCCCGCG-TCGATGTTCACCCTGGATCGCGAGGAGCTTCGGCTCATCGTGTGGGAGTTAGTGGCCAGA","num":1,"hit_to":240,"query_from":57,"identity":240,"query_to":299,"qseq":"ATGGTGCGCCGAGCGCTACGACTGGCGGCCGGCACCGCCTCGCTGGCCGCCGGCACGTGGACTGTTGCGTGCGCTGCACGGCACGCCGGCCGCGCTCGGTGCCGACGCGGCGTCGATCAGGAGCTGTGTCGGAGCAATCGCCGAACTATCGTGACGGCGCCTTCGTCAACCTGGATCCCGCGATCGATGTTCACCCTGGATCGCGAGGAGCTTCGGCTCATCGTGTGGGAGTTAGTGGCCAGA"}],"len":1119,"description":[{"title":"fig|233413.5.peg.1011|Mb0930|VBIMycBov88188_1011|   Outer membrane protein romA   [Mycobacterium bovis AF2122/97 | 233413.5]","id":"fig|233413.5.peg.1011","accession":"132773"}],"num":2}],"query_masking":[{"from":18,"to":33}],"query_id":"Query_1"}}}}],{"fig|83332.12.peg.1009":{"function":"Outer membrane protein romA","alt_locus_tag":"VBIMycTub87468_1009","genome_id":"83332.12","locus_tag":"Rv0906","genome_name":"Mycobacterium tuberculosis H37Rv"},"fig|233413.5.peg.1011":{"function":"Outer membrane protein romA","genome_id":"233413.5","alt_locus_tag":"VBIMycBov88188_1011","locus_tag":"Mb0930","genome_name":"Mycobacterium bovis AF2122/97"}},null,{"fig|83332.12.peg.1009":{"location":"1008944..1010062","gene_id":885150,"accession":"NC_000962","start":1008944,"feature_id":"PATRIC.83332.12.NC_000962.CDS.1008944.1010062.fwd","sequence_id":"NC_000962","annotation":"PATRIC","product":"Outer membrane protein romA","genome_id":"83332.12","figfam_id":"FIG01371060","uniprotkb_accession":["I6XWJ0","P64759"],"gi":15608046,"p2_feature_id":18150533,"pos_group":"NC_000962:1010062:+","alt_locus_tag":"VBIMycTub87468_1009","na_length":1119,"strand":"+","refseq_locus_tag":"Rv0906","segments":["1008944..1010062"],"feature_type":"CDS","taxon_id":83332,"protein_id":"NP_215421.1","aa_length":372,"patric_id":"fig|83332.12.peg.1009","end":1010062,"genome_name":"Mycobacterium tuberculosis H37Rv","public":true,"owner":"PATRIC","date_inserted":"2014-10-20T23:55:03.806Z","date_modified":"2014-10-27T07:44:09.673Z","na_sequence":"atggtgcgccgagcgctacgactggcggccggcaccgcctcgctggccgccggcacgtggctgttgcgtgcgctgcacggcacgccggccgcgctcggtgccgacgcggcgtcgatcagggctgtgtcggagcaatcgccgaactatcgtgacggcgccttcgtcaacctggatcccgcgtcgatgttcaccctggatcgcgaggagcttcggctcatcgtgtgggagttagtggccagacacagtgcgagccggccggcggcgccgatcccgttggcctcgccgaatatctaccggggtgacgccagccggctcgccgtcagctggttcggtcactcgacggcgctgctggaaatcgacggctaccgggtgcttaccgatccggtgtggagcgatcggtgctcaccgtccgacgtcgtcggcccccagcgcctgcatccgccgccggtgcaactggcagctctcccggccgtcgacgccgtggtcatcagccacgaccactacgaccatctcgatatcgacaccgtggttgcgctggtcggcatgcaacgggccccgttccttgtgccgctcggggtcggcgcccaccttcggtcgtggggtgttccgcaggatcgcattgttgagctcgactggaaccagagcgctcaggtcgatgagctcaccgtggtctgcgtgccggcacggcacttctcgggacggttcctgagccgcaacaccacactgtgggcctcgtgggcgtttgttgggccgaaccatcgcgcctacttcggcggtgataccggatacaccaagagcttcacccagatcggcgcggaccacggaccgttcgacctgaccctgctgcccatcggggcctacaacacggcgtggccggacatccacatgaaccccgaggaggcggtccgggcgcacctggacgtcaccgattcgggctcgggaatgctggtgccggtgcactggggcaccttccggctggccccccatccgtggggcgagccggtcgagcggctgctcgcggcggctgaacccgagcacgtcacggtagccgtgccgctacccggtcagcgggtcgacccgaccgggcccatgagattgcacccatggtggcggctgtaa","aa_sequence_md5":"78bc6158e03f08557fc918cd8634140d","aa_sequence":"MVRRALRLAAGTASLAAGTWLLRALHGTPAALGADAASIRAVSEQSPNYRDGAFVNLDPASMFTLDREELRLIVWELVARHSASRPAAPIPLASPNIYRGDASRLAVSWFGHSTALLEIDGYRVLTDPVWSDRCSPSDVVGPQRLHPPPVQLAALPAVDAVVISHDHYDHLDIDTVVALVGMQRAPFLVPLGVGAHLRSWGVPQDRIVELDWNQSAQVDELTVVCVPARHFSGRFLSRNTTLWASWAFVGPNHRAYFGGDTGYTKSFTQIGADHGPFDLTLLPIGAYNTAWPDIHMNPEEAVRAHLDVTDSGSGMLVPVHWGTFRLAPHPWGEPVERLLAAAEPEHVTVAVPLPGQRVDPTGPMRLHPWWRL","pgfam_id":"PGF_00028347","plfam_id":"PLF_1763_00000156"},"fig|233413.5.peg.1011":{"location":"1009409..1010527","gene_id":1092857,"accession":"NC_002945","start":1009409,"feature_id":"PATRIC.233413.5.NC_002945.CDS.1009409.1010527.fwd","sequence_id":"NC_002945","annotation":"PATRIC","product":"Outer membrane protein romA","genome_id":"233413.5","figfam_id":"FIG01371060","uniprotkb_accession":["P64760"],"gi":31792094,"p2_feature_id":18003706,"pos_group":"NC_002945:1010527:+","alt_locus_tag":"VBIMycBov88188_1011","na_length":1119,"strand":"+","refseq_locus_tag":"Mb0930","segments":["1009409..1010527"],"feature_type":"CDS","taxon_id":233413,"protein_id":"NP_854587.1","aa_length":372,"patric_id":"fig|233413.5.peg.1011","end":1010527,"genome_name":"Mycobacterium bovis AF2122/97","public":true,"owner":"PATRIC","date_inserted":"2014-10-20T20:19:41.13Z","date_modified":"2014-10-27T06:55:37.908Z","na_sequence":"atggtgcgccgagcgctacgactggcggccggcaccgcctcgctggccgccggcacgtggctgttgcgtgcgctgcacggcacgccggccgcgctcggtgccgacgcggcgtcgatcagggctgtgtcggagcaatcgccgaactatcgtgacggcgccttcgtcaacctggatcccgcgtcgatgttcaccctggatcgcgaggagcttcggctcatcgtgtgggagttagtggccagacacagtgcgagccggccggcggcgccgatcccgttggcctcgccgaatatctaccggggtgacgccagccggctcgccgtcagctggttcggtcactcgacggcgctgctggaaatcgacggctaccgggtgcttaccgatccggtgtggagcgatcggtgctcaccgtccgacgtcgtcggcccccagcgcctgcatccgccgccggtgcaactggcagctctcccggccgtcgacgccgtggtcatcagccacgaccactacgaccatctcgatatcgacaccgtggttgcgctggtcggcatgcaacgggccccgttccttgtgccgctcggggtcggcgcccaccttcggtcgtggggtgttccgcaggatcgcattgttgagctcgactggaaccagagcgctcaggtcgatgagctcaccgtggtctgcgtgccggcacggcacttctcgggacggttcctgagccgcaacaccacactgtgggcctcgtgggcgtttgttgggccgaaccatcgcgcctacttcggtggtgataccggatacaccaagagcttcacccagatcggcgcggaccacggaccgttcgacctgaccctgctgcccatcggggcctacaacacggcgtggccggacatccacatgaaccccgaggaggcggtccgggcgcacctggacgtcaccgattcgggctcgggaatgctggtgccggtgcactggggcaccttccggctggccccccatccgtggggcgagccggtcgagcggctactcgcggcggctgaacccgagcacgtcacggtagccgtgccgctacccggtcagcgggtcgacccgaccgggcccatgagattgcacccatggtggcggctgtaa","aa_sequence_md5":"78bc6158e03f08557fc918cd8634140d","aa_sequence":"MVRRALRLAAGTASLAAGTWLLRALHGTPAALGADAASIRAVSEQSPNYRDGAFVNLDPASMFTLDREELRLIVWELVARHSASRPAAPIPLASPNIYRGDASRLAVSWFGHSTALLEIDGYRVLTDPVWSDRCSPSDVVGPQRLHPPPVQLAALPAVDAVVISHDHYDHLDIDTVVALVGMQRAPFLVPLGVGAHLRSWGVPQDRIVELDWNQSAQVDELTVVCVPARHFSGRFLSRNTTLWASWAFVGPNHRAYFGGDTGYTKSFTQIGADHGPFDLTLLPIGAYNTAWPDIHMNPEEAVRAHLDVTDSGSGMLVPVHWGTFRLAPHPWGEPVERLLAAAEPEHVTVAVPLPGQRVDPTGPMRLHPWWRL","pgfam_id":"PGF_00028347","plfam_id":"PLF_1763_00000156"}}],"version":"1.1","id":"9067495661058316"}';

			return JSON.parse(r);
		}
	});
});
